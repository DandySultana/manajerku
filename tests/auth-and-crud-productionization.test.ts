import test from "node:test";
import assert from "node:assert/strict";
import { resetTestDatabase } from "../lib/db/client.ts";
import { DEFAULT_STORE_ID } from "../lib/db/seed.ts";
import {
  assertStoreOwnership,
  changeUserPassword,
  loginWithCredentials,
  logoutSession,
  registerAccountAndStore,
  requestPasswordReset,
  resetPasswordWithToken,
  updateAccountStatus,
  updateUserProfile,
  verifySessionToken,
} from "../lib/auth/auth-service.ts";
import { ManajerkuAppError } from "../lib/services/platform-core.ts";
import {
  createMasterProduct,
  deleteMasterProduct,
  listInventoryProducts,
  updateMasterProduct,
} from "../lib/services/fefo-inventory.ts";
import {
  deleteVerifiedSupplier,
  registerVerifiedSupplier,
  updateVerifiedSupplier,
} from "../lib/services/supplier-discovery.ts";
import {
  deleteDownstreamReseller,
  listDownstreamResellers,
  registerDownstreamReseller,
  updateDownstreamReseller,
} from "../lib/services/reseller-promo-broadcast.ts";
import { cancelPurchaseOrderAndReleaseCash } from "../lib/services/whatsapp-ai-procurement.ts";

test("Productionization Suite: Real Authentication, Session Security, Ownership RBAC & Full CRUD", async (t) => {
  await t.test("Auth 1: Register New User & Store, Reject Duplicate Email, Weak Password & Mismatched Confirmation", () => {
    resetTestDatabase(true);

    // Reject weak password
    assert.throws(
      () =>
        registerAccountAndStore({
          fullName: "Cut Tari",
          email: "cut@beku.id",
          phoneWhatsapp: "081266667777",
          password: "short",
          passwordConfirmation: "short",
          storeName: "Toko Cut Beku",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "WEAK_PASSWORD");
        return true;
      }
    );

    // Reject mismatched password confirmation
    assert.throws(
      () =>
        registerAccountAndStore({
          fullName: "Cut Tari",
          email: "cut@beku.id",
          phoneWhatsapp: "081266667777",
          password: "Password123!",
          passwordConfirmation: "Different123!",
          storeName: "Toko Cut Beku",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "PASSWORD_MISMATCH");
        return true;
      }
    );

    // Valid registration
    const reg = registerAccountAndStore({
      fullName: "Cut Tari",
      email: "cut@beku.id",
      phoneWhatsapp: "081266667777",
      password: "Password123!",
      passwordConfirmation: "Password123!",
      storeName: "Toko Cut Beku Aceh",
      initialKulakanCash: 12000000,
    });

    assert.ok(reg.sessionToken.startsWith("mjk_"));
    assert.equal(reg.context.email, "cut@beku.id");
    assert.equal(reg.context.role, "OWNER");
    assert.equal(reg.context.store.name, "Toko Cut Beku Aceh");

    // Reject duplicate email registration
    assert.throws(
      () =>
        registerAccountAndStore({
          fullName: "User Lain",
          email: "CUT@BEKU.ID", // case-insensitive duplicate!
          phoneWhatsapp: "081288889999",
          password: "Password123!",
          passwordConfirmation: "Password123!",
          storeName: "Toko Lain",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "DUPLICATE_EMAIL");
        assert.equal(err.statusCode, 409);
        return true;
      }
    );

    // Cross-store ownership protection: Cut Tari cannot access DEFAULT_STORE_ID
    assert.throws(
      () => assertStoreOwnership(reg.context, DEFAULT_STORE_ID),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "FORBIDDEN_STORE_OWNERSHIP");
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });

  await t.test("Auth 2: Login with Valid/Invalid Credentials, Session Verification & Logout Revocation", () => {
    resetTestDatabase(true);

    // Invalid password must fail with 401 INVALID_CREDENTIALS
    assert.throws(
      () =>
        loginWithCredentials({
          identifier: "mhukmanfathir@gmail.com",
          password: "WrongPassword999",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "INVALID_CREDENTIALS");
        assert.equal(err.statusCode, 401);
        return true;
      }
    );

    // Valid login by Email
    const ownerLogin = loginWithCredentials({
      identifier: "mhukmanfathir@gmail.com",
      password: "Orienix2026!",
    });
    assert.equal(ownerLogin.context.role, "OWNER");
    assert.equal(ownerLogin.context.storeId, DEFAULT_STORE_ID);

    // Valid login by WhatsApp phone number (Cashier)
    const cashierLogin = loginWithCredentials({
      identifier: "0822-1111-2222",
      password: "Kasir2026!",
    });
    assert.equal(cashierLogin.context.role, "CASHIER");

    // Verify token is active before logout
    assert.ok(verifySessionToken(cashierLogin.sessionToken));

    // Logout revokes token in database
    const revoked = logoutSession(cashierLogin.sessionToken);
    assert.equal(revoked, true);
    assert.equal(verifySessionToken(cashierLogin.sessionToken), null);
  });

  await t.test("Auth 3: Profile Update, Change Password, Forgot/Reset Password & Account Suspension", () => {
    resetTestDatabase(true);

    const loginRes = loginWithCredentials({
      identifier: "mhukmanfathir@gmail.com",
      password: "Orienix2026!",
    });

    // Update profile
    const updatedProf = updateUserProfile({
      userId: loginRes.context.userId,
      fullName: "Muhammad Hukman Fathir, S.Kom",
      email: "hukman.orienix@gmail.com",
    });
    assert.equal(updatedProf.fullName, "Muhammad Hukman Fathir, S.Kom");
    assert.equal(updatedProf.email, "hukman.orienix@gmail.com");

    // Change password
    changeUserPassword({
      userId: loginRes.context.userId,
      currentPassword: "Orienix2026!",
      newPassword: "NewSecurePassword2026!",
      newPasswordConfirmation: "NewSecurePassword2026!",
      keepSessionId: loginRes.context.sessionId,
    });

    // Old password must no longer work
    assert.throws(
      () =>
        loginWithCredentials({
          identifier: "hukman.orienix@gmail.com",
          password: "Orienix2026!",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "INVALID_CREDENTIALS");
        return true;
      }
    );

    // Forgot & Reset Password flow
    const resetReq = requestPasswordReset("hukman.orienix@gmail.com");
    assert.ok(resetReq.resetToken.startsWith("rst_"));

    resetPasswordWithToken({
      resetToken: resetReq.resetToken,
      newPassword: "ResetPassword999!",
      newPasswordConfirmation: "ResetPassword999!",
    });

    // Reusing the same reset token a second time must fail
    assert.throws(
      () =>
        resetPasswordWithToken({
          resetToken: resetReq.resetToken,
          newPassword: "AnotherPassword999!",
          newPasswordConfirmation: "AnotherPassword999!",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "INVALID_RESET_TOKEN");
        return true;
      }
    );

    // Login with reset password succeeds
    const reLogin = loginWithCredentials({
      identifier: "hukman.orienix@gmail.com",
      password: "ResetPassword999!",
    });
    assert.equal(reLogin.context.role, "OWNER");

    // Suspend Cashier account -> Cashier cannot login
    updateAccountStatus({
      actorContext: reLogin.context,
      targetUserId: "user-cashier-01",
      accountStatus: "SUSPENDED",
    });

    assert.throws(
      () =>
        loginWithCredentials({
          identifier: "dandy@manajerku.id",
          password: "Kasir2026!",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ManajerkuAppError);
        assert.equal(err.code, "ACCOUNT_SUSPENDED");
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });

  await t.test("Full CRUD: Update & Delete Master SKU, Supplier, Reseller & Cancel PO (PO_CASH_RELEASE)", () => {
    resetTestDatabase(true);

    // 1. SKU Create -> Update -> Delete
    const sku = createMasterProduct({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      skuCode: "SKU-CRUD-01",
      name: "Otak-Otak Ikan 500g",
      packsPerBox: 20,
      retailPricePerPack: 22000,
      wholesalePricePerBox: 400000,
    });
    const updatedSku = updateMasterProduct({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      productId: sku.id,
      name: "Otak-Otak Ikan Super 500g",
      retailPricePerPack: 24000,
      wholesalePricePerBox: 440000,
    });
    assert.equal(updatedSku.name, "Otak-Otak Ikan Super 500g");
    assert.equal(updatedSku.retailPricePerPack, 24000);

    const delSku = deleteMasterProduct({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      productId: sku.id,
    });
    assert.equal(delSku.deactivated, true);
    const activeProds = listInventoryProducts(DEFAULT_STORE_ID);
    assert.equal(activeProds.some((p) => p.id === sku.id), false);

    // 2. Supplier Create -> Update -> Delete
    const supp = registerVerifiedSupplier({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      name: "Distributor CRUD Test",
      phoneWhatsapp: "08116899999",
      address: "Banda Aceh",
      googleRating: 4.7,
      isVerifiedB2BPartner: true,
      commissionRatePct: 1.2,
    });
    const updSupp = updateVerifiedSupplier({
      actorRole: "OWNER",
      supplierId: supp.id,
      name: "Distributor CRUD Updated",
      googleRating: 4.9,
    });
    assert.equal(updSupp.name, "Distributor CRUD Updated");
    assert.equal(updSupp.googleRating, 4.9);

    const delSupp = deleteVerifiedSupplier({
      actorRole: "OWNER",
      supplierId: supp.id,
    });
    assert.equal(delSupp.deactivated, true);

    // 3. Reseller Create -> Update (Opt-out) -> Delete
    const res = registerDownstreamReseller({
      storeId: DEFAULT_STORE_ID,
      businessName: "Dimsum CRUD Aceh",
      contactName: "Bang CRUD",
      phoneWhatsapp: "08526099999",
      culinarySegment: "DIMSUM",
    });
    const updRes = updateDownstreamReseller({
      storeId: DEFAULT_STORE_ID,
      resellerId: res.id,
      isPromoSubscribed: false,
    });
    assert.equal(updRes.isPromoSubscribed, false);

    const delRes = deleteDownstreamReseller({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      resellerId: res.id,
    });
    assert.equal(delRes.deleted, true);
    assert.equal(
      listDownstreamResellers(DEFAULT_STORE_ID).some((r) => r.id === res.id),
      false
    );

    // 4. Cancel PO (#PO-2611-02) -> Releases Rp 2.025.000 locked cash back to Kas Siap Kulakan!
    const cancelPoRes = cancelPurchaseOrderAndReleaseCash({
      storeId: DEFAULT_STORE_ID,
      actorRole: "OWNER",
      poIdOrNumber: "#PO-2611-02",
      reason: "Distributor terlambat mengirim",
    });
    assert.equal(cancelPoRes.status, "CANCELLED");
    assert.equal(cancelPoRes.releasedCashRp, 2025000);
    assert.equal(cancelPoRes.availableKulakanCashAfterRp, 16875000); // 14,850,000 + 2,025,000
    assert.equal(cancelPoRes.lockedPoCashAfterRp, 0);
  });
});

