/**
 * Manajerku — Relational ACID Database Schema (7 Core Atomic Tables + Supporting Entities)
 * Grounded in Proposal Tim Orienix (UIN Ar-Raniry Banda Aceh) & Master PRD v1.0.0
 *
 * Compatible with Node.js built-in SQLite (DatabaseSync with STRICT foreign keys & ACID transactions)
 * and standard PostgreSQL.
 */

export const MANAJERKU_SQL_DDL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  branch_name TEXT NOT NULL DEFAULT 'Cabang Utama',
  address TEXT NOT NULL DEFAULT 'Jl. T. Nyak Arief, Banda Aceh',
  cold_chain_code TEXT NOT NULL DEFAULT 'Cold-Chain ID-01',
  last_recorded_temp_c REAL NOT NULL DEFAULT -18.4,
  temp_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  latitude REAL NOT NULL DEFAULT 5.5482900,
  longitude REAL NOT NULL DEFAULT 95.3237530,
  daily_freezer_elec_cost INTEGER NOT NULL DEFAULT 45000 CHECK (daily_freezer_elec_cost >= 0),
  profit_reinvestment_pct REAL NOT NULL DEFAULT 20.0 CHECK (profit_reinvestment_pct >= 0 AND profit_reinvestment_pct <= 100),
  rfq_timeout_minutes INTEGER NOT NULL DEFAULT 15 CHECK (rfq_timeout_minutes >= 1),
  subscription_tier TEXT NOT NULL DEFAULT 'FREEMIUM_STARTER' CHECK (subscription_tier IN ('FREEMIUM_STARTER', 'MANAJERKU_PRO')),
  subscription_expires_at TEXT,
  qris_image_data_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone_whatsapp TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  password_salt TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'CASHIER', 'ADMIN')),
  account_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_token
  ON auth_sessions (token_hash);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  window_start_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_verifications (
  id TEXT PRIMARY KEY,
  phone_whatsapp TEXT NOT NULL,
  otp_code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- ATOMIC TABLE #1: products (Master SKU & Multi-Unit Conversion)
-- ============================================================================
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sku_code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Frozen Food',
  retail_unit_name TEXT NOT NULL DEFAULT 'Pack',
  wholesale_unit_name TEXT NOT NULL DEFAULT 'Dus',
  packs_per_box INTEGER NOT NULL CHECK (packs_per_box >= 1),
  retail_price_per_pack INTEGER NOT NULL CHECK (retail_price_per_pack > 0),
  wholesale_price_per_box INTEGER NOT NULL CHECK (wholesale_price_per_box > 0),
  standard_cogs_per_pack INTEGER NOT NULL DEFAULT 15000 CHECK (standard_cogs_per_pack >= 0),
  reorder_point_packs INTEGER NOT NULL DEFAULT 40 CHECK (reorder_point_packs >= 0),
  default_reorder_boxes INTEGER NOT NULL DEFAULT 5 CHECK (default_reorder_boxes >= 1),
  is_below_rop INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (store_id, sku_code)
);

-- ============================================================================
-- ATOMIC TABLE #4: suppliers (Supplier Directory & Shared Cache)
-- ============================================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
  google_place_id TEXT UNIQUE,
  name TEXT NOT NULL,
  phone_whatsapp TEXT NOT NULL UNIQUE,
  is_whatsapp_active INTEGER NOT NULL DEFAULT 1,
  address TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  distance_km REAL NOT NULL DEFAULT 2.50,
  google_rating REAL NOT NULL CHECK (google_rating >= 0.0 AND google_rating <= 5.0),
  user_ratings_total INTEGER NOT NULL DEFAULT 10,
  is_verified_b2b_partner INTEGER NOT NULL DEFAULT 0,
  commission_rate_pct REAL NOT NULL DEFAULT 0.00 CHECK (commission_rate_pct >= 0.00 AND commission_rate_pct <= 5.00),
  cached_catalog_json TEXT NOT NULL DEFAULT '{}',
  last_synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- ATOMIC TABLE #5: rfq_sessions (Stateful Multi-Turn Auto-RFQ Sessions)
-- ============================================================================
CREATE TABLE IF NOT EXISTS rfq_sessions (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  rfq_code TEXT NOT NULL UNIQUE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  requested_qty_boxes INTEGER NOT NULL CHECK (requested_qty_boxes > 0),
  trigger_source TEXT NOT NULL DEFAULT 'AUTO_ROP' CHECK (trigger_source IN ('AUTO_ROP', 'MANUAL')),
  status TEXT NOT NULL CHECK (status IN (
    'AWAITING_OWNER_RFQ_APPROVAL',
    'NEGOTIATING',
    'AWAITING_OWNER_PO_APPROVAL',
    'PO_ISSUED',
    'CANCELLED'
  )),
  supplier_quotes_json TEXT NOT NULL DEFAULT '[]',
  recommended_supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  best_price_per_box INTEGER,
  estimated_po_total INTEGER,
  cash_usage_pct REAL,
  owner_rfq_approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- ATOMIC TABLE #6: purchase_orders (Verified Purchase Orders / PO)
-- ============================================================================
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  po_number TEXT NOT NULL UNIQUE,
  rfq_session_id TEXT REFERENCES rfq_sessions(id) ON DELETE SET NULL,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  order_qty_boxes INTEGER NOT NULL CHECK (order_qty_boxes > 0),
  order_qty_packs INTEGER NOT NULL CHECK (order_qty_packs > 0),
  agreed_price_per_box INTEGER NOT NULL CHECK (agreed_price_per_box > 0),
  reference_market_price_per_box INTEGER NOT NULL DEFAULT 0,
  discount_pct REAL NOT NULL DEFAULT 0.00,
  total_amount INTEGER NOT NULL CHECK (total_amount > 0),
  cash_usage_pct REAL NOT NULL DEFAULT 0.00,
  promised_batch_expiry TEXT NOT NULL,
  batch_code_note TEXT,
  delivery_notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('APPROVED_WA', 'PDF_SENT', 'RECEIVED_OCR', 'CANCELLED')),
  pdf_document_url TEXT NOT NULL,
  b2b_commission_amount INTEGER NOT NULL DEFAULT 0,
  approved_by_user_id TEXT NOT NULL REFERENCES users(id),
  approved_at TEXT NOT NULL DEFAULT (datetime('now')),
  received_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- ATOMIC TABLE #2: inventory_batches (FEFO Cold-Chain Batch Queue)
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory_batches (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  batch_number TEXT NOT NULL,
  source_po_id TEXT REFERENCES purchase_orders(id) ON DELETE SET NULL,
  initial_qty_packs INTEGER NOT NULL CHECK (initial_qty_packs > 0),
  current_qty_packs INTEGER NOT NULL CHECK (current_qty_packs >= 0),
  unit_cogs_pack INTEGER NOT NULL CHECK (unit_cogs_pack >= 0),
  promo_discount_pct REAL NOT NULL DEFAULT 0.00 CHECK (promo_discount_pct >= 0 AND promo_discount_pct < 100),
  expiry_date TEXT NOT NULL,
  fefo_status TEXT NOT NULL CHECK (fefo_status IN (
    'SAFE',
    'PRIORITY_FEFO',
    'CRITICAL',
    'EXPIRED',
    'DEPLETED',
    'WRITTEN_OFF'
  )),
  received_via TEXT NOT NULL DEFAULT 'MANUAL' CHECK (received_via IN ('VISION_OCR', 'MANUAL')),
  ocr_image_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_batches_fefo_queue
  ON inventory_batches (store_id, product_id, expiry_date ASC, created_at ASC);

-- ============================================================================
-- SUPPORTING TABLE: resellers (Downstream Culinary Micro-Vendors)
-- ============================================================================
CREATE TABLE IF NOT EXISTS resellers (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  phone_whatsapp TEXT NOT NULL,
  culinary_segment TEXT NOT NULL DEFAULT 'BURGER',
  is_promo_subscribed INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- ATOMIC TABLE #3: pos_transactions & pos_transaction_items (Web POS)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pos_transactions (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL UNIQUE,
  cashier_user_id TEXT NOT NULL REFERENCES users(id),
  cashier_label TEXT NOT NULL DEFAULT 'Kasir 01',
  reseller_id TEXT REFERENCES resellers(id) ON DELETE SET NULL,
  customer_name_snapshot TEXT NOT NULL DEFAULT 'Pelanggan Umum',
  customer_type_label TEXT NOT NULL DEFAULT 'Walk-in Eceran',
  service_type TEXT NOT NULL DEFAULT 'TAKEAWAY_PICKUP',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'QRIS')),
  payment_status TEXT NOT NULL DEFAULT 'PAID' CHECK (payment_status IN ('PAID', 'VOIDED')),
  items_summary_text TEXT NOT NULL,
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  total_discount INTEGER NOT NULL DEFAULT 0,
  total_cogs INTEGER NOT NULL CHECK (total_cogs >= 0),
  gross_profit INTEGER NOT NULL,
  cash_received INTEGER NOT NULL DEFAULT 0,
  change_amount INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pos_transaction_items (
  id TEXT PRIMARY KEY,
  pos_transaction_id TEXT NOT NULL REFERENCES pos_transactions(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name_snapshot TEXT NOT NULL,
  sold_unit_type TEXT NOT NULL CHECK (sold_unit_type IN ('PACK', 'BOX')),
  sold_qty INTEGER NOT NULL CHECK (sold_qty > 0),
  deducted_packs_qty INTEGER NOT NULL CHECK (deducted_packs_qty > 0),
  unit_selling_price INTEGER NOT NULL,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  subtotal_amount INTEGER NOT NULL,
  cogs_amount INTEGER NOT NULL,
  batch_allocations_json TEXT NOT NULL DEFAULT '[]'
);

-- ============================================================================
-- ATOMIC TABLE #7: cash_ledger (Immutable Separated Cash & KUR Ledger)
-- ============================================================================
CREATE TABLE IF NOT EXISTS cash_ledger (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'INITIAL_CAPITAL',
    'POS_SALE_REVENUE',
    'PO_CASH_LOCK',
    'PO_CASH_RELEASE',
    'PO_SETTLEMENT',
    'FREEZER_ELECTRICITY_EXPENSE',
    'EXPIRED_WRITE_OFF_LOSS',
    'PROFIT_REINVESTMENT',
    'OWNER_DRAWING'
  )),
  reference_type TEXT NOT NULL CHECK (reference_type IN ('POS_INV', 'PO_DOC', 'DAILY_CRON', 'MANUAL', 'WRITE_OFF')),
  reference_id TEXT,
  amount INTEGER NOT NULL,
  cogs_component INTEGER NOT NULL DEFAULT 0,
  profit_component INTEGER NOT NULL DEFAULT 0,
  available_kulakan_cash_after INTEGER NOT NULL,
  locked_po_cash_after INTEGER NOT NULL,
  net_profit_balance_after INTEGER NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cash_ledger_store_date
  ON cash_ledger (store_id, created_at DESC);

-- ============================================================================
-- SUPPORTING TABLES: FEFO Promo Campaigns, OCR Logs & WhatsApp Message Logs
-- ============================================================================
CREATE TABLE IF NOT EXISTS fefo_promo_campaigns (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES inventory_batches(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  discount_pct REAL NOT NULL DEFAULT 20.00,
  promo_price_per_pack INTEGER NOT NULL,
  promo_price_per_box INTEGER NOT NULL,
  target_reseller_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  message_template TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT_READY', 'BROADCASTING', 'ACTIVE_SENT', 'COMPLETED_SOLD_OUT', 'EXPIRED')),
  approved_by_user_id TEXT REFERENCES users(id),
  broadcasted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ocr_receiving_logs (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  submitted_by_user_id TEXT NOT NULL REFERENCES users(id),
  image_url TEXT NOT NULL,
  caption_text TEXT,
  raw_gemini_json TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  created_batch_id TEXT REFERENCES inventory_batches(id),
  matched_po_id TEXT REFERENCES purchase_orders(id),
  status TEXT NOT NULL CHECK (status IN ('AUTO_COMMITTED', 'NEEDS_CONFIRMATION', 'REJECTED_EXPIRED')),
  response_message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS whatsapp_messages_log (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  sender_phone TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  detected_role TEXT NOT NULL CHECK (detected_role IN ('OWNER', 'CASHIER', 'SUPPLIER', 'RESELLER', 'SYSTEM', 'UNKNOWN')),
  message_type TEXT NOT NULL DEFAULT 'TEXT' CHECK (message_type IN ('TEXT', 'IMAGE_OCR', 'PDF_PO', 'PROMO_BROADCAST')),
  content_text TEXT NOT NULL,
  media_url TEXT,
  related_rfq_id TEXT,
  related_po_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- DAILY METRICS HISTORY TABLE (7-Day Revenue vs Kulakan PO Chart)
-- ============================================================================
CREATE TABLE IF NOT EXISTS daily_financial_snapshots (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  snapshot_date TEXT NOT NULL,
  day_label TEXT NOT NULL,
  pos_revenue_amount INTEGER NOT NULL DEFAULT 0,
  po_kulakan_amount INTEGER NOT NULL DEFAULT 0,
  pos_invoice_count INTEGER NOT NULL DEFAULT 0,
  net_profit_amount INTEGER NOT NULL DEFAULT 0,
  freezer_elec_cost INTEGER NOT NULL DEFAULT 45000,
  UNIQUE (store_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS playwright_scrape_runs (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  search_query TEXT NOT NULL,
  raw_keyword TEXT NOT NULL,
  location_hint TEXT,
  rfq_code TEXT,
  results_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
