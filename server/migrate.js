import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import pg from 'pg';

await loadEnvFile('.env');
await loadEnvFile('.env.local');

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'migrations');
const LOCK_NAMESPACE = 802501;
const LOCK_KEY = 202605;
const checkOnly = process.argv.includes('--check');

const REQUIRED_COLUMNS = {
  app_users: ['id', 'email', 'password_hash', 'created_at'],
  admin_audit_logs: [
    'id', 'store_id', 'actor_id', 'action', 'target_type',
    'target_id', 'metadata', 'created_at',
  ],
  stores: [
    'id', 'name', 'address', 'currency', 'tax_rate', 'logo_url', 'receipt_header',
    'receipt_footer', 'points_per_amount', 'low_stock_threshold', 'industry',
    'features', 'created_at', 'invoice_signature_url', 'invoice_signer_name', 'shop_phone', 'return_policy', 'warranty_info', 'pdp_banner_url', 'shop_city',
    'bank_name', 'bank_account_number', 'bank_account_name', 'qris_image_url',
    'social_facebook', 'social_instagram', 'social_tiktok', 'social_youtube',
    'footer_links', 'chat_enabled',
    'meta_pixel_id', 'tiktok_pixel_id', 'google_ads_id', 'google_ads_purchase_label',
  ],
  profiles: ['id', 'store_id', 'full_name', 'email', 'role', 'avatar_url', 'created_at'],
  categories: ['id', 'store_id', 'name', 'icon', 'sort_order', 'created_at'],
  products: [
    'id', 'store_id', 'category_id', 'name', 'description', 'image_url',
    'base_price', 'sizes', 'is_active', 'sku', 'barcode', 'cost_price',
    'stock_qty', 'min_stock', 'track_stock', 'created_at', 'weight_gram',
    'length_cm', 'width_cm', 'height_cm', 'brand', 'variant_name', 'parent_sku', 'compare_at_price',
    'images', 'spec', 'variant_label', 'warranty_type', 'warranty_period', 'box_contents',
    'highlights', 'license_type', 'license_code', 'video_url',
  ],
  product_reviews: [
    'id', 'store_id', 'product_id', 'order_id', 'customer_id', 'reviewer_name', 'rating',
    'body', 'images', 'variant_label', 'is_hidden', 'seller_reply', 'replied_at', 'created_at',
    'tags', 'helpful_count',
  ],
  customer_password_resets: [
    'id', 'user_id', 'store_id', 'code_hash', 'attempts', 'expires_at', 'used_at', 'created_at',
  ],
  product_questions: [
    'id', 'store_id', 'product_id', 'customer_id', 'asker_name', 'question', 'answer',
    'answered_at', 'is_hidden', 'created_at',
  ],
  customers: [
    'id', 'store_id', 'name', 'phone', 'email', 'location', 'joined_date',
    'is_active', 'points', 'created_at', 'address', 'user_id', 'privacy_accepted_at',
    'address_province', 'address_city',
  ],
  promos: ['id', 'store_id', 'code', 'name', 'type', 'value', 'start_date', 'end_date', 'is_active', 'created_at'],
  flash_sales: ['id', 'store_id', 'name', 'starts_at', 'ends_at', 'is_active', 'created_at'],
  flash_sale_items: [
    'id', 'store_id', 'flash_sale_id', 'product_id', 'flash_price',
    'quota_qty', 'sold_qty', 'created_at',
  ],
  orders: [
    'id', 'store_id', 'customer_id', 'cashier_id', 'shift_id', 'order_number',
    'subtotal', 'tax', 'discount', 'total', 'payment_method', 'payment_status',
    'order_status', 'order_type', 'table_number', 'notes', 'promo_code',
    'received_amount', 'change_amount', 'points_earned', 'created_at',
    'sales_channel', 'payment_term', 'due_date', 'paid_amount', 'settled_at',
    'original_total', 'adjustment_amount', 'adjustment_note', 'adjusted_at',
    'adjusted_by', 'external_order_no', 'customer_name', 'customer_phone',
    'delivery_address', 'shipping_cost', 'tax_inclusive',
    'payment_channel', 'payment_reference', 'payment_url',
    'delivery_province', 'delivery_city',
    'marketplace_fee', 'net_settled', 'settlement_date', 'fee_detail',
  ],
  order_returns: [
    'id', 'store_id', 'order_id', 'order_number', 'refund_amount', 'reason',
    'created_by', 'created_at',
  ],
  order_return_items: [
    'id', 'return_id', 'product_id', 'name', 'sku', 'barcode', 'qty',
    'refund_price', 'restock', 'note',
  ],
  order_items: ['id', 'order_id', 'product_id', 'name', 'size', 'qty', 'price', 'cost_price', 'note'],
  shifts: [
    'id', 'store_id', 'cashier_id', 'opened_at', 'closed_at', 'opening_cash',
    'closing_cash', 'expected_cash', 'total_sales', 'total_orders', 'notes',
    'created_at',
  ],
  cash_movements: ['id', 'store_id', 'shift_id', 'type', 'amount', 'note', 'created_at'],
  stock_movements: ['id', 'store_id', 'product_id', 'type', 'qty_delta', 'reason', 'ref_order_id', 'created_at'],
  loyalty_transactions: ['id', 'store_id', 'customer_id', 'points_delta', 'reason', 'ref_order_id', 'created_at'],
  suppliers: [
    'id', 'store_id', 'name', 'contact_name', 'phone', 'email', 'address',
    'default_term_days', 'default_dp_percent', 'notes', 'is_active', 'created_at',
    'currency', 'exchange_rate',
  ],
  purchases: [
    'id', 'store_id', 'supplier_id', 'invoice_number', 'status', 'order_date',
    'expected_date', 'due_date', 'subtotal', 'discount', 'tax', 'other_cost',
    'other_cost_label', 'other_cost_date', 'other_cost_category',
    'extra_cost', 'extra_cost_label', 'extra_cost_date', 'extra_cost_category',
    'total', 'paid_amount', 'dp_percent', 'received_at', 'notes', 'created_by',
    'created_at', 'currency', 'exchange_rate',
  ],
  purchase_items: [
    'id', 'purchase_id', 'product_id', 'name', 'sku', 'qty', 'received_qty',
    'cost_price', 'subtotal', 'note', 'barcode', 'original_cost_price', 'currency',
  ],
  purchase_payments: [
    'id', 'store_id', 'purchase_id', 'type', 'amount', 'method', 'paid_at',
    'reference', 'note', 'created_by', 'created_at',
  ],
  sales_channels: [
    'id', 'store_id', 'code', 'name', 'fee_percent', 'default_term_days',
    'is_active', 'sort_order', 'created_at',
  ],
  order_payments: [
    'id', 'store_id', 'order_id', 'amount', 'method', 'paid_at', 'reference',
    'note', 'created_by', 'created_at',
  ],
  role_permissions: [
    'id', 'store_id', 'role', 'capability', 'enabled', 'updated_at',
  ],
  stock_opnames: [
    'id', 'store_id', 'status', 'note', 'counted_by', 'started_at',
    'posted_at', 'created_at',
  ],
  stock_opname_items: [
    'id', 'opname_id', 'product_id', 'system_qty', 'counted_qty', 'note',
  ],
  product_components: [
    'id', 'store_id', 'parent_product_id', 'component_product_id', 'qty', 'created_at',
  ],
  expenses: [
    'id', 'store_id', 'category', 'description', 'amount', 'expense_date',
    'payment_method', 'shift_id', 'created_by', 'created_at',
    'purchase_id', 'purchase_cost_slot',
  ],
  product_channel_mappings: [
    'id', 'store_id', 'product_id', 'channel_code', 'external_sku',
    'external_url', 'is_synced', 'last_synced_at', 'created_at',
  ],
  supplier_product_mappings: [
    'id', 'store_id', 'supplier_id', 'product_id', 'supplier_sku',
    'supplier_barcode', 'supplier_product_name', 'last_cost_price',
    'currency', 'created_at',
  ],
};

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL belum diisi.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: parseBool(process.env.DB_SSL) ? { rejectUnauthorized: false } : undefined,
});

try {
  await migrate();
} catch (error) {
  printPgError(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}

async function migrate() {
  const lock = await pool.connect();
  try {
    await lock.query('select pg_advisory_lock($1, $2)', [LOCK_NAMESPACE, LOCK_KEY]);
    if (checkOnly) {
      await validateSchema();
      console.log('schema ok');
      return;
    }

    await ensureMigrationTable();

    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();
    if (!files.length) throw new Error(`Tidak ada file migrasi SQL di ${migrationsDir}`);

    for (const file of files) {
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      const checksum = sha256(sql);
      const applied = await pool.query(
        'select checksum from public.schema_migrations where filename = $1',
        [file],
      );

      if (applied.rowCount) {
        const previousChecksum = applied.rows[0].checksum;
        if (previousChecksum && previousChecksum !== checksum) {
          throw new Error(
            `Checksum migrasi berubah untuk ${file}. Buat file migrasi baru, jangan edit file yang sudah applied.`,
          );
        }
        if (!previousChecksum) {
          await pool.query(
            'update public.schema_migrations set checksum = $2 where filename = $1',
            [file, checksum],
          );
        }
        console.log(`skip ${file}`);
        continue;
      }

      await applyMigration(file, sql, checksum);
    }

    await validateSchema();
    console.log('schema ok');
  } finally {
    await lock.query('select pg_advisory_unlock($1, $2)', [LOCK_NAMESPACE, LOCK_KEY]).catch(() => {});
    lock.release();
  }
}

async function ensureMigrationTable() {
  await pool.query(`
    create table if not exists public.schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  await pool.query('alter table public.schema_migrations add column if not exists checksum text');
}

async function applyMigration(file, sql, checksum) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query(
      'insert into public.schema_migrations(filename, checksum) values ($1, $2)',
      [file, checksum],
    );
    await client.query('commit');
    console.log(`applied ${file}`);
  } catch (error) {
    await client.query('rollback');
    error.message = `Gagal menjalankan migrasi ${file}: ${error.message}`;
    throw error;
  } finally {
    client.release();
  }
}

async function validateSchema() {
  const tableNames = Object.keys(REQUIRED_COLUMNS);
  const tableRes = await pool.query(
    `
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name = any($1::text[])
    `,
    [tableNames],
  );
  const existingTables = new Set(tableRes.rows.map((row) => row.table_name));
  const missingTables = tableNames.filter((table) => !existingTables.has(table));
  if (missingTables.length) throw new Error(`Tabel belum lengkap: ${missingTables.join(', ')}`);

  const columnRes = await pool.query(
    `
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = any($1::text[])
    `,
    [tableNames],
  );
  const columnsByTable = new Map();
  for (const row of columnRes.rows) {
    if (!columnsByTable.has(row.table_name)) columnsByTable.set(row.table_name, new Set());
    columnsByTable.get(row.table_name).add(row.column_name);
  }

  const missingColumns = [];
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const existing = columnsByTable.get(table) ?? new Set();
    for (const column of columns) {
      if (!existing.has(column)) missingColumns.push(`${table}.${column}`);
    }
  }
  if (missingColumns.length) {
    throw new Error(`Kolom belum lengkap: ${missingColumns.join(', ')}`);
  }

  for (const signature of [
    'public.apply_order_stock(uuid)',
    'public.receive_purchase(uuid)',
    'public.receive_purchase_actual(uuid, jsonb)',
    'public.void_orders(uuid, uuid[], boolean)',
  ]) {
    const fn = await pool.query('select to_regprocedure($1) as fn', [signature]);
    if (!fn.rows[0]?.fn) throw new Error(`Function ${signature} belum tersedia.`);
  }
}

function parseBool(value) {
  return /^(1|true|yes)$/i.test(String(value ?? ''));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function printPgError(error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (error?.code) console.error(`Postgres code: ${error.code}`);
  if (error?.detail) console.error(`Detail: ${error.detail}`);
  if (error?.hint) console.error(`Hint: ${error.hint}`);
}

async function loadEnvFile(filename) {
  try {
    const raw = await fs.readFile(path.resolve(process.cwd(), filename), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, '');
    }
  } catch {
    // optional file
  }
}
