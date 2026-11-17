import crypto from "node:crypto";
import { getDb, runAtomicTransaction } from "../db/client.ts";
import {
  getRolePermissions,
  ManajerkuAppError,
  normalizePhoneE164,
  type RolePermissions,
  type SubscriptionTier,
  type UserRole,
} from "../services/platform-core.ts";
import {
  hashOpaqueToken,
  hashPassword,
  normalizeAndValidateEmail,
  validatePasswordStrength,
  verifyPassword,
} from "./password.ts";

export const SESSION_COOKIE_NAME = "manajerku_session";

export interface AuthenticatedUserContext {
  sessionId: string;
  userId: string;
  storeId: string;
  fullName: string;
  email: string | null;
  phoneWhatsapp: string;
  role: UserRole;
  accountStatus: "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
  permissions: RolePermissions;
  store: {
    id: string;
    name: string;
    branchName: string;
    coldChainCode: string;
    lastRecordedTempC: number;
    subscriptionTier: SubscriptionTier;
  };
}

/**
 * Rate limiter stored in database to protect sensitive auth endpoints against brute-force.
 */
export function enforceRateLimit(
  bucketKey: string,
  maxAttempts = 10,
  windowMs = 60_000
): void {
  const db = getDb();
  const now = Date.now();
  const existing = db
    .prepare(
      "SELECT attempt_count, window_start_ms FROM rate_limit_buckets WHERE bucket_key = ?"
    )
    .get(bucketKey) as
    | { attempt_count: number; window_start_ms: number }
    | undefined;

  if (!existing || now - existing.window_start_ms > windowMs) {
    db.prepare(`
      INSERT INTO rate_limit_buckets (bucket_key, attempt_count, window_start_ms)
      VALUES (?, 1, ?)
      ON CONFLICT(bucket_key) DO UPDATE SET attempt_count = 1, window_start_ms = excluded.window_start_ms
    `).run(bucketKey, now);
    return;
  }

  if (existing.attempt_count >= maxAttempts) {
    throw new ManajerkuAppError(
      "RATE_LIMIT_EXCEEDED",
      "Terlalu banyak percobaan dalam waktu singkat. Silakan tunggu 1 menit sebelum mencoba kembali.",
      429
    );
  }

  db.prepare(
    "UPDATE rate_limit_buckets SET attempt_count = attempt_count + 1 WHERE bucket_key = ?"
  ).run(bucketKey);
}

/**
 * Creates a new persistent session record in auth_sessions and returns the raw opaque token.
 */
export function createAuthSessionInDb(params: {
  userId: string;
  storeId: string;
  ipAddress?: string;
  userAgent?: string;
}): {
  sessionId: string;
  rawSessionToken: string;
  expiresAt: string;
} {
  const db = getDb();
  const sessionId = `sess-${crypto.randomUUID()}`;
  const rawSessionToken = `mjk_${crypto.randomBytes(32).toString("hex")}`;
  const tokenHash = hashOpaqueToken(rawSessionToken);
  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000
  ).toISOString();

  db.prepare(`
    INSERT INTO auth_sessions (
      id, user_id, store_id, token_hash, ip_address, user_agent, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    params.userId,
    params.storeId,
    tokenHash,
    params.ipAddress || "127.0.0.1",
    params.userAgent || "Manajerku-Client",
    expiresAt
  );

  return {
    sessionId,
    rawSessionToken,
    expiresAt,
  };
}

export interface RegisterAccountInput {
  fullName: string;
  email: string;
  phoneWhatsapp: string;
  password: string;
  passwordConfirmation: string;
  storeName: string;
  branchName?: string;
  address?: string;
  initialKulakanCash?: number;
  dailyFreezerElecCost?: number;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Section 2.1: Real User & Store Registration with Password Hashing, Uniqueness Validation & Session Creation
 */
export function registerAccountAndStore(input: RegisterAccountInput): {
  sessionToken: string;
  expiresAt: string;
  context: AuthenticatedUserContext;
} {
  enforceRateLimit(`register:${input.ipAddress || "local"}`, 15, 60_000);

  if (!input.fullName || input.fullName.trim().length < 2) {
    throw new ManajerkuAppError(
      "INVALID_NAME",
      "Nama lengkap wajib diisi minimal 2 karakter.",
      400
    );
  }
  if (!input.storeName || input.storeName.trim().length < 2) {
    throw new ManajerkuAppError(
      "INVALID_STORE_NAME",
      "Nama toko wajib diisi minimal 2 karakter.",
      400
    );
  }

  const email = normalizeAndValidateEmail(input.email);
  const phoneWhatsapp = normalizePhoneE164(input.phoneWhatsapp);

  validatePasswordStrength(input.password);
  if (input.password !== input.passwordConfirmation) {
    throw new ManajerkuAppError(
      "PASSWORD_MISMATCH",
      "Konfirmasi password tidak cocok dengan password yang dimasukkan.",
      400
    );
  }

  const { passwordHash, passwordSalt } = hashPassword(input.password);

  const createdIds = runAtomicTransaction((db) => {
    const existingEmail = db
      .prepare("SELECT id FROM users WHERE LOWER(email) = ?")
      .get(email);
    if (existingEmail) {
      throw new ManajerkuAppError(
        "DUPLICATE_EMAIL",
        "Alamat email ini sudah terdaftar. Silakan login atau gunakan email lain.",
        409
      );
    }

    const existingPhone = db
      .prepare("SELECT id FROM users WHERE phone_whatsapp = ?")
      .get(phoneWhatsapp);
    if (existingPhone) {
      throw new ManajerkuAppError(
        "PHONE_ALREADY_REGISTERED",
        "Nomor WhatsApp ini sudah terdaftar pada akun lain.",
        409
      );
    }

    const storeId = `store-${crypto.randomUUID().slice(0, 8)}`;
    const userId = `user-${crypto.randomUUID().slice(0, 8)}`;
    const initialCash = Math.max(0, Math.round(input.initialKulakanCash ?? 10000000));
    const dailyElec = Math.max(0, Math.round(input.dailyFreezerElecCost ?? 45000));

    db.prepare(`
      INSERT INTO stores (
        id, name, branch_name, address, cold_chain_code, last_recorded_temp_c,
        latitude, longitude, daily_freezer_elec_cost, profit_reinvestment_pct,
        rfq_timeout_minutes, subscription_tier
      ) VALUES (?, ?, ?, ?, 'Cold-Chain ID-01', -18.4, 5.56829, 95.36375, ?, 20.0, 15, 'FREEMIUM_STARTER')
    `).run(
      storeId,
      input.storeName.trim(),
      (input.branchName || "Cabang Utama").trim(),
      (input.address || "Banda Aceh").trim(),
      dailyElec
    );

    db.prepare(`
      INSERT INTO users (
        id, store_id, full_name, email, phone_whatsapp,
        password_hash, password_salt, role, account_status, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OWNER', 'ACTIVE', 1)
    `).run(
      userId,
      storeId,
      input.fullName.trim(),
      email,
      phoneWhatsapp,
      passwordHash,
      passwordSalt
    );

    db.prepare(`
      INSERT INTO cash_ledger (
        id, store_id, entry_type, reference_type, reference_id, amount,
        cogs_component, profit_component, available_kulakan_cash_after,
        locked_po_cash_after, net_profit_balance_after, notes
      ) VALUES (?, ?, 'INITIAL_CAPITAL', 'MANUAL', 'INIT-REG', ?, ?, 0, ?, 0, 0, 'Modal kerja awal saat registrasi akun')
    `).run(
      `led-${crypto.randomUUID().slice(0, 8)}`,
      storeId,
      initialCash,
      initialCash,
      initialCash
    );

    const days = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
    const insertSnap = db.prepare(`
      INSERT INTO daily_financial_snapshots (
        id, store_id, snapshot_date, day_label, pos_revenue_amount,
        po_kulakan_amount, pos_invoice_count, net_profit_amount, freezer_elec_cost
      ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0)
    `);
    for (let i = 0; i < 7; i++) {
      insertSnap.run(
        `snap-${storeId}-${i}`,
        storeId,
        `2026-11-${(10 + i).toString().padStart(2, "0")}`,
        days[i]
      );
    }

    return { storeId, userId };
  });

  const session = createAuthSessionInDb({
    userId: createdIds.userId,
    storeId: createdIds.storeId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  const context = verifySessionToken(session.rawSessionToken)!;
  return {
    sessionToken: session.rawSessionToken,
    expiresAt: session.expiresAt,
    context,
  };
}

/**
 * Section 2.2: Real Credential Login (Email or WhatsApp Phone + Password)
 */
export function loginWithCredentials(params: {
  identifier: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
}): {
  sessionToken: string;
  expiresAt: string;
  context: AuthenticatedUserContext;
} {
  const rawIdentifier = (params.identifier || "").trim();
  if (!rawIdentifier || !params.password) {
    throw new ManajerkuAppError(
      "MISSING_CREDENTIALS",
      "Email/Nomor WhatsApp dan Password wajib diisi.",
      400
    );
  }

  enforceRateLimit(`login:${rawIdentifier.toLowerCase()}`, 10, 60_000);

  const db = getDb();
  let lookupPhone: string | null = null;
  if (!rawIdentifier.includes("@")) {
    try {
      lookupPhone = normalizePhoneE164(rawIdentifier);
    } catch {
      lookupPhone = rawIdentifier;
    }
  }

  const user = db
    .prepare(
      `SELECT id, store_id, full_name, email, phone_whatsapp,
              password_hash, password_salt, role, account_status, is_active
       FROM users
       WHERE LOWER(email) = ? OR phone_whatsapp = ?
       LIMIT 1`
    )
    .get(rawIdentifier.toLowerCase(), lookupPhone || rawIdentifier) as
    | {
        id: string;
        store_id: string;
        full_name: string;
        email: string | null;
        phone_whatsapp: string;
        password_hash: string;
        password_salt: string;
        role: UserRole;
        account_status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
        is_active: number;
      }
    | undefined;

  if (
    !user ||
    !verifyPassword(params.password, user.password_hash, user.password_salt)
  ) {
    throw new ManajerkuAppError(
      "INVALID_CREDENTIALS",
      "Email/Nomor WhatsApp atau Password yang Anda masukkan salah.",
      401
    );
  }

  if (!user.is_active || user.account_status !== "ACTIVE") {
    throw new ManajerkuAppError(
      "ACCOUNT_SUSPENDED",
      `Akun Anda sedang berstatus ${user.account_status}. Hubungi pemilik toko atau administrator.`,
      403
    );
  }

  const session = createAuthSessionInDb({
    userId: user.id,
    storeId: user.store_id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  const context = verifySessionToken(session.rawSessionToken)!;
  return {
    sessionToken: session.rawSessionToken,
    expiresAt: session.expiresAt,
    context,
  };
}

/**
 * Verifies an opaque session token against the auth_sessions table.
 */
export function verifySessionToken(
  rawSessionToken: string | null | undefined
): AuthenticatedUserContext | null {
  if (!rawSessionToken || !rawSessionToken.startsWith("mjk_")) {
    return null;
  }

  const tokenHash = hashOpaqueToken(rawSessionToken);
  const db = getDb();

  const row = db
    .prepare(
      `SELECT
         s.id as session_id, s.expires_at, s.revoked_at,
         u.id as user_id, u.store_id, u.full_name, u.email, u.phone_whatsapp,
         u.role, u.account_status, u.is_active,
         st.name as store_name, st.branch_name, st.cold_chain_code,
         st.last_recorded_temp_c, st.subscription_tier
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN stores st ON st.id = s.store_id
       WHERE s.token_hash = ?
       LIMIT 1`
    )
    .get(tokenHash) as
    | {
        session_id: string;
        expires_at: string;
        revoked_at: string | null;
        user_id: string;
        store_id: string;
        full_name: string;
        email: string | null;
        phone_whatsapp: string;
        role: UserRole;
        account_status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
        is_active: number;
        store_name: string;
        branch_name: string;
        cold_chain_code: string;
        last_recorded_temp_c: number;
        subscription_tier: SubscriptionTier;
      }
    | undefined;

  if (!row) return null;
  if (row.revoked_at !== null) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  if (!row.is_active || row.account_status !== "ACTIVE") return null;

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    storeId: row.store_id,
    fullName: row.full_name,
    email: row.email,
    phoneWhatsapp: row.phone_whatsapp,
    role: row.role,
    accountStatus: row.account_status,
    permissions: getRolePermissions(row.role),
    store: {
      id: row.store_id,
      name: row.store_name,
      branchName: row.branch_name,
      coldChainCode: row.cold_chain_code,
      lastRecordedTempC: row.last_recorded_temp_c,
      subscriptionTier: row.subscription_tier,
    },
  };
}

/**
 * Revokes an active session token in the database (Logout).
 */
export function logoutSession(rawSessionToken: string | null | undefined): boolean {
  if (!rawSessionToken) return false;
  const tokenHash = hashOpaqueToken(rawSessionToken);
  const db = getDb();
  const res = db
    .prepare(
      "UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL"
    )
    .run(new Date().toISOString(), tokenHash);
  return Number(res.changes) > 0;
}

/**
 * Section 6: Enforce Store Ownership & Resource Boundary
 */
export function assertStoreOwnership(
  authContext: AuthenticatedUserContext,
  targetStoreId: string
): void {
  if (authContext.role === "ADMIN") return;
  if (authContext.storeId !== targetStoreId) {
    throw new ManajerkuAppError(
      "FORBIDDEN_STORE_OWNERSHIP",
      "Akses ditolak: Anda tidak memiliki hak akses terhadap data toko lain.",
      403
    );
  }
}

/**
 * Section 2.3: Account Management - Edit Profile
 */
export function updateUserProfile(params: {
  userId: string;
  fullName?: string;
  email?: string;
  phoneWhatsapp?: string;
}) {
  return runAtomicTransaction((db) => {
    const user = db
      .prepare(
        "SELECT id, store_id, full_name, email, phone_whatsapp, role, account_status FROM users WHERE id = ?"
      )
      .get(params.userId) as
      | {
          id: string;
          store_id: string;
          full_name: string;
          email: string | null;
          phone_whatsapp: string;
          role: UserRole;
          account_status: string;
        }
      | undefined;

    if (!user) {
      throw new ManajerkuAppError("USER_NOT_FOUND", "Pengguna tidak ditemukan.", 404);
    }

    const nextName = params.fullName ? params.fullName.trim() : user.full_name;
    if (nextName.length < 2) {
      throw new ManajerkuAppError("INVALID_NAME", "Nama lengkap minimal 2 karakter.", 400);
    }

    let nextEmail = user.email;
    if (params.email !== undefined && params.email.trim() !== "") {
      nextEmail = normalizeAndValidateEmail(params.email);
      const dupEmail = db
        .prepare("SELECT id FROM users WHERE LOWER(email) = ? AND id != ?")
        .get(nextEmail, user.id);
      if (dupEmail) {
        throw new ManajerkuAppError(
          "DUPLICATE_EMAIL",
          "Email tersebut sudah digunakan oleh akun lain.",
          409
        );
      }
    }

    let nextPhone = user.phone_whatsapp;
    if (params.phoneWhatsapp !== undefined && params.phoneWhatsapp.trim() !== "") {
      nextPhone = normalizePhoneE164(params.phoneWhatsapp);
      const dupPhone = db
        .prepare("SELECT id FROM users WHERE phone_whatsapp = ? AND id != ?")
        .get(nextPhone, user.id);
      if (dupPhone) {
        throw new ManajerkuAppError(
          "PHONE_ALREADY_REGISTERED",
          "Nomor WhatsApp tersebut sudah digunakan oleh akun lain.",
          409
        );
      }
    }

    db.prepare(`
      UPDATE users
      SET full_name = ?, email = ?, phone_whatsapp = ?
      WHERE id = ?
    `).run(nextName, nextEmail, nextPhone, user.id);

    return {
      userId: user.id,
      storeId: user.store_id,
      fullName: nextName,
      email: nextEmail,
      phoneWhatsapp: nextPhone,
      role: user.role,
    };
  });
}

/**
 * Section 2.3: Account Management - Change Password
 */
export function changeUserPassword(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  newPasswordConfirmation: string;
  keepSessionId?: string;
}) {
  validatePasswordStrength(params.newPassword);
  if (params.newPassword !== params.newPasswordConfirmation) {
    throw new ManajerkuAppError(
      "PASSWORD_MISMATCH",
      "Konfirmasi password baru tidak cocok.",
      400
    );
  }

  return runAtomicTransaction((db) => {
    const user = db
      .prepare(
        "SELECT id, password_hash, password_salt FROM users WHERE id = ?"
      )
      .get(params.userId) as
      | { id: string; password_hash: string; password_salt: string }
      | undefined;

    if (!user) {
      throw new ManajerkuAppError("USER_NOT_FOUND", "Pengguna tidak ditemukan.", 404);
    }

    if (
      !verifyPassword(
        params.currentPassword,
        user.password_hash,
        user.password_salt
      )
    ) {
      throw new ManajerkuAppError(
        "INVALID_CURRENT_PASSWORD",
        "Password saat ini yang Anda masukkan tidak sesuai.",
        401
      );
    }

    const { passwordHash, passwordSalt } = hashPassword(params.newPassword);
    db.prepare(
      "UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?"
    ).run(passwordHash, passwordSalt, user.id);

    // Revoke other active sessions for security
    if (params.keepSessionId) {
      db.prepare(
        "UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL"
      ).run(new Date().toISOString(), user.id, params.keepSessionId);
    }

    return { updated: true };
  });
}

/**
 * Section 2.3: Forgot Password & Reset Password with Time-Limited Token
 */
export function requestPasswordReset(identifier: string): {
  resetToken: string;
  expiresAt: string;
  targetEmailOrPhone: string;
} {
  const cleaned = identifier.trim();
  enforceRateLimit(`forgot-pwd:${cleaned.toLowerCase()}`, 5, 60_000);

  const db = getDb();
  let phoneCandidate = cleaned;
  if (!cleaned.includes("@")) {
    try {
      phoneCandidate = normalizePhoneE164(cleaned);
    } catch {
      phoneCandidate = cleaned;
    }
  }

  const user = db
    .prepare(
      "SELECT id, email, phone_whatsapp FROM users WHERE LOWER(email) = ? OR phone_whatsapp = ? LIMIT 1"
    )
    .get(cleaned.toLowerCase(), phoneCandidate) as
    | { id: string; email: string | null; phone_whatsapp: string }
    | undefined;

  if (!user) {
    throw new ManajerkuAppError(
      "ACCOUNT_NOT_FOUND",
      "Akun dengan email atau nomor WhatsApp tersebut tidak ditemukan.",
      404
    );
  }

  const rawResetToken = `rst_${crypto.randomBytes(24).toString("hex")}`;
  const tokenHash = hashOpaqueToken(rawResetToken);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(`prt-${crypto.randomUUID().slice(0, 8)}`, user.id, tokenHash, expiresAt);

  return {
    resetToken: rawResetToken,
    expiresAt,
    targetEmailOrPhone: user.email || user.phone_whatsapp,
  };
}

export function resetPasswordWithToken(params: {
  resetToken: string;
  newPassword: string;
  newPasswordConfirmation: string;
}) {
  validatePasswordStrength(params.newPassword);
  if (params.newPassword !== params.newPasswordConfirmation) {
    throw new ManajerkuAppError(
      "PASSWORD_MISMATCH",
      "Konfirmasi password baru tidak cocok.",
      400
    );
  }

  const tokenHash = hashOpaqueToken((params.resetToken || "").trim());

  return runAtomicTransaction((db) => {
    const tokenRow = db
      .prepare(
        "SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ? LIMIT 1"
      )
      .get(tokenHash) as
      | {
          id: string;
          user_id: string;
          expires_at: string;
          used_at: string | null;
        }
      | undefined;

    if (!tokenRow || tokenRow.used_at !== null) {
      throw new ManajerkuAppError(
        "INVALID_RESET_TOKEN",
        "Token reset password tidak valid atau sudah pernah digunakan.",
        400
      );
    }

    if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
      throw new ManajerkuAppError(
        "RESET_TOKEN_EXPIRED",
        "Token reset password telah kedaluwarsa. Silakan minta token baru.",
        400
      );
    }

    const { passwordHash, passwordSalt } = hashPassword(params.newPassword);
    const nowIso = new Date().toISOString();

    db.prepare(
      "UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?"
    ).run(passwordHash, passwordSalt, tokenRow.user_id);

    db.prepare(
      "UPDATE password_reset_tokens SET used_at = ? WHERE id = ?"
    ).run(nowIso, tokenRow.id);

    // Revoke all old sessions after password reset
    db.prepare(
      "UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL"
    ).run(nowIso, tokenRow.user_id);

    return {
      userId: tokenRow.user_id,
      resetSuccess: true,
    };
  });
}

/**
 * Section 2.3: Account Status Management (Owner / Admin can suspend or reactivate staff accounts)
 */
export function updateAccountStatus(params: {
  actorContext: AuthenticatedUserContext;
  targetUserId: string;
  accountStatus: "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
}) {
  if (!params.actorContext.permissions.canManageUsers) {
    throw new ManajerkuAppError(
      "FORBIDDEN_ROLE",
      "Hanya Pemilik Toko (Owner) atau Admin yang dapat mengubah status akun pengguna.",
      403
    );
  }

  return runAtomicTransaction((db) => {
    const target = db
      .prepare("SELECT id, store_id, role FROM users WHERE id = ?")
      .get(params.targetUserId) as
      | { id: string; store_id: string; role: UserRole }
      | undefined;

    if (!target) {
      throw new ManajerkuAppError("USER_NOT_FOUND", "Pengguna tidak ditemukan.", 404);
    }

    assertStoreOwnership(params.actorContext, target.store_id);

    const isActive = params.accountStatus === "ACTIVE" ? 1 : 0;
    db.prepare(
      "UPDATE users SET account_status = ?, is_active = ? WHERE id = ?"
    ).run(params.accountStatus, isActive, target.id);

    if (!isActive) {
      db.prepare(
        "UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL"
      ).run(new Date().toISOString(), target.id);
    }

    return {
      userId: target.id,
      accountStatus: params.accountStatus,
      isActive: Boolean(isActive),
    };
  });
}

