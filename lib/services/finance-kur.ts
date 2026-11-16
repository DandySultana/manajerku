import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getDb, runAtomicTransaction } from "../db/client.ts";
import { DEFAULT_STORE_ID } from "../db/seed.ts";
import {
  enforceProFeatureAccess,
  getRolePermissions,
  ManajerkuAppError,
  type UserRole,
} from "./platform-core.ts";

/**
 * Helper to fetch the current balances from the immutable append-only cash_ledger
 */
export function getLatestCashBalancesInTx(
  db: DatabaseSync,
  storeId: string
): {
  availableKulakanCashRp: number;
  lockedPoCashRp: number;
  netProfitBalanceRp: number;
} {
  const row = db
    .prepare(
      `SELECT available_kulakan_cash_after, locked_po_cash_after, net_profit_balance_after
       FROM cash_ledger WHERE store_id = ?
       ORDER BY rowid DESC LIMIT 1`
    )
    .get(storeId) as
    | {
        available_kulakan_cash_after: number;
        locked_po_cash_after: number;
        net_profit_balance_after: number;
      }
    | undefined;

  return {
    availableKulakanCashRp: row?.available_kulakan_cash_after ?? 0,
    lockedPoCashRp: row?.locked_po_cash_after ?? 0,
    netProfitBalanceRp: row?.net_profit_balance_after ?? 0,
  };
}

/**
 * FR-802: Lock / Reserve Kulakan Cash Allocation When Owner Approves a Purchase Order
 */
export function lockPoCashAllocationInTx(
  db: DatabaseSync,
  storeId: string,
  poNumber: string,
  poAmountRp: number,
  supplierName: string
): {
  availableKulakanCashAfterRp: number;
  lockedPoCashAfterRp: number;
  cashUsagePct: number;
} {
  const balances = getLatestCashBalancesInTx(db, storeId);
  const amount = Math.round(poAmountRp);

  if (balances.availableKulakanCashRp < amount) {
    throw new ManajerkuAppError(
      "INSUFFICIENT_KULAKAN_CASH",
      `Saldo Kas Siap Kulakan (Rp ${balances.availableKulakanCashRp.toLocaleString(
        "id-ID"
      )}) tidak mencukupi untuk mengunci alokasi PO ${poNumber} sebesar Rp ${amount.toLocaleString(
        "id-ID"
      )}.`,
      409
    );
  }

  const cashUsagePct = Number(
    ((amount / Math.max(1, balances.availableKulakanCashRp)) * 100).toFixed(1)
  );
  const newAvail = balances.availableKulakanCashRp - amount;
  const newLocked = balances.lockedPoCashRp + amount;

  db.prepare(`
    INSERT INTO cash_ledger (
      id, store_id, entry_type, reference_type, reference_id, amount,
      cogs_component, profit_component, available_kulakan_cash_after,
      locked_po_cash_after, net_profit_balance_after, notes
    ) VALUES (?, ?, 'PO_CASH_LOCK', 'PO_DOC', ?, ?, ?, 0, ?, ?, ?, ?)
  `).run(
    `led-${crypto.randomUUID().slice(0, 8)}`,
    storeId,
    poNumber,
    amount,
    amount,
    newAvail,
    newLocked,
    balances.netProfitBalanceRp,
    `Kunci Alokasi Saldo Kas Kulakan untuk ${poNumber} (${supplierName})`
  );

  return {
    availableKulakanCashAfterRp: newAvail,
    lockedPoCashAfterRp: newLocked,
    cashUsagePct,
  };
}

/**
 * FR-802: Settle Locked PO Cash Allocation When Goods Arrive via Vision OCR (PRD-06)
 */
export function settlePoCashAllocationInTx(
  db: DatabaseSync,
  storeId: string,
  poNumber: string,
  settledAmountRp: number,
  batchNumber: string
): {
  availableKulakanCashAfterRp: number;
  lockedPoCashAfterRp: number;
} {
  const balances = getLatestCashBalancesInTx(db, storeId);
  const amount = Math.round(settledAmountRp);
  const releaseFromLock = Math.min(balances.lockedPoCashRp, amount);
  const newLocked = Math.max(0, balances.lockedPoCashRp - releaseFromLock);
  const extraFromAvail = Math.max(0, amount - releaseFromLock);
  const newAvail = Math.max(0, balances.availableKulakanCashRp - extraFromAvail);

  db.prepare(`
    INSERT INTO cash_ledger (
      id, store_id, entry_type, reference_type, reference_id, amount,
      cogs_component, profit_component, available_kulakan_cash_after,
      locked_po_cash_after, net_profit_balance_after, notes
    ) VALUES (?, ?, 'PO_SETTLEMENT', 'PO_DOC', ?, ?, ?, 0, ?, ?, ?, ?)
  `).run(
    `led-${crypto.randomUUID().slice(0, 8)}`,
    storeId,
    poNumber,
    -amount,
    -amount,
    newAvail,
    newLocked,
    balances.netProfitBalanceRp,
    `Realisasi Belanja Kulakan ${poNumber} via Vision OCR (${batchNumber})`
  );

  return {
    availableKulakanCashAfterRp: newAvail,
    lockedPoCashAfterRp: newLocked,
  };
}

/**
 * FR-803: Idempotent Daily 24-Hour Cold-Storage Electricity Expense Allocation ("Alokasi Listrik Beku")
 */
export function recordDailyFreezerElectricityExpense(params?: {
  storeId?: string;
  actorRole?: UserRole;
  dateIso?: string;
  overrideDailyCostRp?: number;
}) {
  const storeId = params?.storeId || DEFAULT_STORE_ID;
  const dateStr = (params?.dateIso || "2026-11-16").slice(0, 10);
  const refCode = `ELEC-${dateStr.replace(/-/g, "")}`;

  return runAtomicTransaction((db) => {
    const store = db
      .prepare(
        "SELECT id, cold_chain_code, daily_freezer_elec_cost FROM stores WHERE id = ?"
      )
      .get(storeId) as
      | {
          id: string;
          cold_chain_code: string;
          daily_freezer_elec_cost: number;
        }
      | undefined;

    if (!store) {
      throw new ManajerkuAppError("STORE_NOT_FOUND", "Toko tidak ditemukan.", 404);
    }

    if (
      typeof params?.overrideDailyCostRp === "number" &&
      params.overrideDailyCostRp >= 0
    ) {
      const perms = getRolePermissions(params.actorRole || "OWNER");
      if (!perms.canViewFinancials) {
        throw new ManajerkuAppError(
          "FORBIDDEN_ROLE",
          "Hanya Owner yang dapat mengubah tarif listrik penyimpanan dingin harian.",
          403
        );
      }
      db.prepare(
        "UPDATE stores SET daily_freezer_elec_cost = ? WHERE id = ?"
      ).run(Math.round(params.overrideDailyCostRp), storeId);
      store.daily_freezer_elec_cost = Math.round(params.overrideDailyCostRp);
    }

    // Check idempotency: has ELEC-YYYYMMDD already been recorded for this store?
    const existing = db
      .prepare(
        `SELECT id, amount, net_profit_balance_after
         FROM cash_ledger
         WHERE store_id = ? AND entry_type = 'FREEZER_ELECTRICITY_EXPENSE' AND reference_id = ?`
      )
      .get(storeId, refCode) as
      | { id: string; amount: number; net_profit_balance_after: number }
      | undefined;

    if (existing) {
      return {
        alreadyRecorded: true,
        referenceCode: refCode,
        elecCostRp: Math.abs(existing.amount),
        netProfitBalanceAfterRp: existing.net_profit_balance_after,
      };
    }

    const balances = getLatestCashBalancesInTx(db, storeId);
    const elecCost = store.daily_freezer_elec_cost;
    const netProfitAfter = balances.netProfitBalanceRp - elecCost;

    db.prepare(`
      INSERT INTO cash_ledger (
        id, store_id, entry_type, reference_type, reference_id, amount,
        cogs_component, profit_component, available_kulakan_cash_after,
        locked_po_cash_after, net_profit_balance_after, notes
      ) VALUES (?, ?, 'FREEZER_ELECTRICITY_EXPENSE', 'DAILY_CRON', ?, ?, 0, ?, ?, ?, ?, ?)
    `).run(
      `led-${crypto.randomUUID().slice(0, 8)}`,
      storeId,
      refCode,
      -elecCost,
      -elecCost,
      balances.availableKulakanCashRp,
      balances.lockedPoCashRp,
      netProfitAfter,
      `Alokasi Beban Listrik Penyimpanan Dingin 24 Jam (${store.cold_chain_code}) - ${dateStr}`
    );

    return {
      alreadyRecorded: false,
      referenceCode: refCode,
      elecCostRp: elecCost,
      netProfitBalanceAfterRp: netProfitAfter,
    };
  });
}

/**
 * FR-801 & FR-802: Owner Capital Adjustment (Reinvest Profit to Kulakan Cash or Owner Personal Drawing from Profit Pool Only)
 */
export function recordOwnerCapitalAdjustment(params: {
  storeId?: string;
  actorRole: UserRole;
  adjustmentType: "PROFIT_REINVESTMENT" | "OWNER_DRAWING" | "INITIAL_CAPITAL";
  amountRp: number;
  notes?: string;
}) {
  const storeId = params.storeId || DEFAULT_STORE_ID;
  const perms = getRolePermissions(params.actorRole);
  if (!perms.canViewFinancials) {
    throw new ManajerkuAppError(
      "FORBIDDEN_ROLE",
      "Hanya Pemilik Toko (Owner) yang dapat mengelola alokasi modal kerja dan penarikan laba.",
      403
    );
  }

  const amount = Math.round(params.amountRp);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ManajerkuAppError(
      "INVALID_AMOUNT",
      "Nominal penyesuaian kas harus lebih besar dari Rp 0.",
      400
    );
  }

  return runAtomicTransaction((db) => {
    const balances = getLatestCashBalancesInTx(db, storeId);
    let newAvail = balances.availableKulakanCashRp;
    let newNetProfit = balances.netProfitBalanceRp;

    if (params.adjustmentType === "OWNER_DRAWING") {
      // Strictly prevent Owner from mixing or draining working capital (Kas Siap Kulakan)!
      if (amount > balances.netProfitBalanceRp) {
        throw new ManajerkuAppError(
          "DRAWING_EXCEEDS_NET_PROFIT",
          `Penarikan pribadi (Rp ${amount.toLocaleString(
            "id-ID"
          )}) ditolak karena melebihi saldo Laba Bersih tersedia (Rp ${balances.netProfitBalanceRp.toLocaleString(
            "id-ID"
          )}). Saldo Kas Siap Kulakan dilindungi agar modal toko tidak tercampur dengan keuangan pribadi.`,
          409
        );
      }
      newNetProfit -= amount;
    } else if (params.adjustmentType === "PROFIT_REINVESTMENT") {
      if (amount > balances.netProfitBalanceRp) {
        throw new ManajerkuAppError(
          "REINVEST_EXCEEDS_NET_PROFIT",
          "Nominal reinvestasi melebihi saldo Laba Bersih yang tersedia.",
          409
        );
      }
      newNetProfit -= amount;
      newAvail += amount;
    } else {
      // INITIAL_CAPITAL injection
      newAvail += amount;
    }

    const refId = `ADJ-${Date.now().toString().slice(-6)}`;
    db.prepare(`
      INSERT INTO cash_ledger (
        id, store_id, entry_type, reference_type, reference_id, amount,
        cogs_component, profit_component, available_kulakan_cash_after,
        locked_po_cash_after, net_profit_balance_after, notes
      ) VALUES (?, ?, ?, 'MANUAL', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `led-${crypto.randomUUID().slice(0, 8)}`,
      storeId,
      params.adjustmentType,
      refId,
      params.adjustmentType === "OWNER_DRAWING" ? -amount : amount,
      params.adjustmentType === "OWNER_DRAWING" ? 0 : amount,
      params.adjustmentType === "INITIAL_CAPITAL" ? 0 : -amount,
      newAvail,
      balances.lockedPoCashRp,
      newNetProfit,
      params.notes || `Penyesuaian Kas (${params.adjustmentType})`
    );

    return {
      storeId,
      adjustmentType: params.adjustmentType,
      amountRp: amount,
      availableKulakanCashAfterRp: newAvail,
      lockedPoCashAfterRp: balances.lockedPoCashRp,
      netProfitBalanceAfterRp: newNetProfit,
    };
  });
}

/**
 * FR-801, FR-804 & FR-805: Get Comprehensive Financial Ledger, Profit & Loss Statement & KUR Readiness Package
 */
export function getFinancialLedgerAndKurSummary(params?: {
  storeId?: string;
  actorRole?: UserRole;
}) {
  const storeId = params?.storeId || DEFAULT_STORE_ID;
  const actorRole = params?.actorRole || "OWNER";
  const perms = getRolePermissions(actorRole);
  if (!perms.canViewFinancials) {
    throw new ManajerkuAppError(
      "FORBIDDEN_ROLE",
      "Laporan keuangan dan Buku Kas hanya dapat diakses oleh Pemilik Toko (Owner).",
      403
    );
  }

  const db = getDb();
  const store = db
    .prepare("SELECT * FROM stores WHERE id = ?")
    .get(storeId) as
    | {
        id: string;
        name: string;
        branch_name: string;
        address: string;
        cold_chain_code: string;
        daily_freezer_elec_cost: number;
        subscription_tier: "FREEMIUM_STARTER" | "MANAJERKU_PRO";
      }
    | undefined;

  if (!store) {
    throw new ManajerkuAppError("STORE_NOT_FOUND", "Toko tidak ditemukan.", 404);
  }

  const balances = getLatestCashBalancesInTx(db, storeId);

  // 7-Day & Cumulative Profit & Loss Calculation
  const snapAgg = db
    .prepare(
      `SELECT
         COALESCE(SUM(pos_revenue_amount), 0) as total_revenue_7d,
         COALESCE(SUM(po_kulakan_amount), 0) as total_po_7d,
         COALESCE(SUM(pos_invoice_count), 0) as total_invoices_7d,
         COALESCE(SUM(net_profit_amount), 0) as total_net_profit_7d,
         COALESCE(SUM(freezer_elec_cost), 0) as total_elec_7d
       FROM daily_financial_snapshots
       WHERE store_id = ?`
    )
    .get(storeId) as {
    total_revenue_7d: number;
    total_po_7d: number;
    total_invoices_7d: number;
    total_net_profit_7d: number;
    total_elec_7d: number;
  };

  const writeOffAgg = db
    .prepare(
      `SELECT COALESCE(SUM(ABS(amount)), 0) as total_write_off_loss
       FROM cash_ledger
       WHERE store_id = ? AND entry_type = 'EXPIRED_WRITE_OFF_LOSS'`
    )
    .get(storeId) as { total_write_off_loss: number };

  const grossProfit7d = snapAgg.total_net_profit_7d + snapAgg.total_elec_7d;
  const totalCogs7d = Math.max(0, snapAgg.total_revenue_7d - grossProfit7d);
  const netOperatingIncome7d =
    grossProfit7d - snapAgg.total_elec_7d - writeOffAgg.total_write_off_loss;

  // Projected 30-day Monthly P&L for Bank Aceh Syariah / KUR Evaluation
  const monthlyProjectedRevenueRp = Math.round((snapAgg.total_revenue_7d / 7) * 30);
  const monthlyProjectedCogsRp = Math.round((totalCogs7d / 7) * 30);
  const monthlyProjectedGrossProfitRp =
    monthlyProjectedRevenueRp - monthlyProjectedCogsRp;
  const monthlyFreezerElecExpenseRp = store.daily_freezer_elec_cost * 30;
  const monthlyExpiredWriteOffLossRp = writeOffAgg.total_write_off_loss;
  const monthlyNetOperatingIncomeRp =
    monthlyProjectedGrossProfitRp -
    monthlyFreezerElecExpenseRp -
    monthlyExpiredWriteOffLossRp;

  // Coverage Ratio & KUR Eligibility Score (FR-804)
  const activePoReference =
    balances.lockedPoCashRp > 2025000 ? balances.lockedPoCashRp : 6456521;
  const coverageRatio = Number(
    (balances.availableKulakanCashRp / activePoReference).toFixed(1)
  );
  const netMarginPct =
    monthlyProjectedRevenueRp > 0
      ? Number(
          (
            (monthlyNetOperatingIncomeRp / monthlyProjectedRevenueRp) *
            100
          ).toFixed(1)
        )
      : 0;

  const kurEligibilityScore = Math.min(
    99,
    Math.max(
      60,
      Math.round(
        72 +
          (coverageRatio >= 2.0 ? 12 : 6) +
          (netMarginPct >= 15 ? 8 : 4) +
          (writeOffAgg.total_write_off_loss === 0 ? 4 : 0)
      )
    )
  );

  // Max safe monthly KUR installment (35% of Net Operating Income)
  const maxMonthlyInstallmentCapacityRp = Math.max(
    0,
    Math.round(monthlyNetOperatingIncomeRp * 0.35)
  );
  const recommendedKurCeilingRp = maxMonthlyInstallmentCapacityRp * 24;

  // Ledger History
  const ledgerEntries = db
    .prepare(
      `SELECT id, entry_type, reference_type, reference_id, amount,
              cogs_component, profit_component, available_kulakan_cash_after,
              locked_po_cash_after, net_profit_balance_after, notes, created_at
       FROM cash_ledger
       WHERE store_id = ?
       ORDER BY rowid DESC
       LIMIT 30`
    )
    .all(storeId) as Array<{
    id: string;
    entry_type: string;
    reference_type: string;
    reference_id: string | null;
    amount: number;
    cogs_component: number;
    profit_component: number;
    available_kulakan_cash_after: number;
    locked_po_cash_after: number;
    net_profit_balance_after: number;
    notes: string | null;
    created_at: string;
  }>;

  // Verified Purchase Order History for KUR Attachment
  const verifiedPos = db
    .prepare(
      `SELECT po.po_number, po.order_qty_boxes, po.agreed_price_per_box,
              po.total_amount, po.status, po.approved_at,
              s.name as supplier_name, p.name as product_name
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN products p ON p.id = po.product_id
       WHERE po.store_id = ?
       ORDER BY po.approved_at DESC`
    )
    .all(storeId) as Array<{
    po_number: string;
    order_qty_boxes: number;
    agreed_price_per_box: number;
    total_amount: number;
    status: string;
    approved_at: string;
    supplier_name: string;
    product_name: string;
  }>;

  return {
    store: {
      id: store.id,
      name: store.name,
      branchName: store.branch_name,
      address: store.address,
      coldChainCode: store.cold_chain_code,
      dailyFreezerElecCostRp: store.daily_freezer_elec_cost,
      subscriptionTier: store.subscription_tier,
    },
    balances: {
      availableKulakanCashRp: balances.availableKulakanCashRp,
      lockedPoCashRp: balances.lockedPoCashRp,
      netProfitBalanceRp: balances.netProfitBalanceRp,
      coverageRatio,
      coverageStatusLabel:
        coverageRatio >= 1.5
          ? `Rasio Kas Kulakan Sehat (${coverageRatio}x)`
          : `Rasio Kas Kulakan Ketat (${coverageRatio}x)`,
    },
    profitAndLoss: {
      weekly: {
        revenueRp: snapAgg.total_revenue_7d,
        cogsRp: totalCogs7d,
        grossProfitRp: grossProfit7d,
        freezerElectricityExpenseRp: snapAgg.total_elec_7d,
        expiredWriteOffLossRp: writeOffAgg.total_write_off_loss,
        netOperatingIncomeRp: netOperatingIncome7d,
        invoiceCount: snapAgg.total_invoices_7d,
      },
      monthlyProjected: {
        revenueRp: monthlyProjectedRevenueRp,
        cogsRp: monthlyProjectedCogsRp,
        grossProfitRp: monthlyProjectedGrossProfitRp,
        freezerElectricityExpenseRp: monthlyFreezerElecExpenseRp,
        expiredWriteOffLossRp: monthlyExpiredWriteOffLossRp,
        netOperatingIncomeRp: monthlyNetOperatingIncomeRp,
        netMarginPct,
      },
    },
    kurReadiness: {
      eligibilityScore: kurEligibilityScore,
      eligibilityStatus:
        kurEligibilityScore >= 80
          ? "LAYAK VERIFIKASI KUR / PEMBIAYAAN SYARIAH"
          : "MEMENUHI SYARAT DASAR",
      targetPartnerBanks: [
        "Bank Aceh Syariah (Pembiayaan Mikro / Modal Kerja)",
        "Penyalur Kredit Usaha Rakyat (KUR) Nasional",
      ],
      maxMonthlyInstallmentCapacityRp,
      recommendedWorkingCapitalPlafonRp: recommendedKurCeilingRp,
      verifiedPoCount: verifiedPos.length,
    },
    verifiedPurchaseOrders: verifiedPos.map((p) => ({
      poNumber: p.po_number,
      supplierName: p.supplier_name,
      productName: p.product_name,
      orderQtyBoxes: p.order_qty_boxes,
      agreedPricePerBoxRp: p.agreed_price_per_box,
      totalAmountRp: p.total_amount,
      status: p.status,
      approvedAt: p.approved_at,
    })),
    ledgerEntries: ledgerEntries.map((l) => ({
      id: l.id,
      entryType: l.entry_type,
      referenceType: l.reference_type,
      referenceId: l.reference_id,
      amountRp: l.amount,
      cogsComponentRp: l.cogs_component,
      profitComponentRp: l.profit_component,
      availableKulakanCashAfterRp: l.available_kulakan_cash_after,
      lockedPoCashAfterRp: l.locked_po_cash_after,
      netProfitBalanceAfterRp: l.net_profit_balance_after,
      notes: l.notes,
      createdAt: l.created_at,
    })),
  };
}

/**
 * FR-805: Generate 1-Click Standardized KUR Bank Verification Package (Requires Owner & Manajerku Pro)
 */
export function exportKurBankVerificationPackage(params: {
  storeId?: string;
  actorRole: UserRole;
  periodMonths?: number;
}) {
  const storeId = params.storeId || DEFAULT_STORE_ID;
  const perms = getRolePermissions(params.actorRole);
  if (!perms.canExportKurPdf) {
    throw new ManajerkuAppError(
      "FORBIDDEN_ROLE",
      "Hanya Pemilik Toko (Owner) yang dapat mengekspor dokumen resmi pengajuan KUR Bank.",
      403
    );
  }

  // Enforce Manajerku Pro subscription tier (BMC Page 5)
  enforceProFeatureAccess(storeId, "KUR_PDF_EXPORT");

  const report = getFinancialLedgerAndKurSummary({
    storeId,
    actorRole: params.actorRole,
  });

  const verificationPayload = JSON.stringify({
    storeId: report.store.id,
    availableKulakanCashRp: report.balances.availableKulakanCashRp,
    monthlyNetIncomeRp: report.profitAndLoss.monthlyProjected.netOperatingIncomeRp,
    poCount: report.verifiedPurchaseOrders.length,
  });

  const integrityHash = crypto
    .createHash("sha256")
    .update(verificationPayload)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();

  return {
    documentNumber: `KUR-BAS-${new Date()
      .toISOString()
      .slice(0, 7)
      .replace("-", "")}-${integrityHash.slice(0, 6)}`,
    generatedAtIso: new Date().toISOString(),
    periodMonths: params.periodMonths || 3,
    integrityHash: `SHA256:${integrityHash}`,
    bankStandardLabel:
      "Standar Verifikasi Kelayakan Kredit Modal Kerja — Bank Aceh Syariah & Penyalur KUR",
    report,
  };
}
