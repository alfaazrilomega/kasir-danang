import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';

loadEnvFile('.env');
loadEnvFile('.env.local');

const { Pool, types } = pg;
const scrypt = promisify(crypto.scrypt);

types.setTypeParser(1700, (value) => parseFloat(value));

const INDUSTRY_FEATURES = {
  fnb: {
    useOrderType: true,
    useTable: true,
    useSizes: true,
    defaultTrackStock: true,
  },
  retail: {
    useOrderType: false,
    useTable: false,
    useSizes: false,
    defaultTrackStock: true,
  },
  bakery: {
    useOrderType: false,
    useTable: false,
    useSizes: false,
    defaultTrackStock: true,
  },
  service: {
    useOrderType: false,
    useTable: false,
    useSizes: false,
    defaultTrackStock: false,
  },
};

const SAMPLE_DATA = {
  fnb: {
    categories: [
      { name: 'Hot Coffee', icon: 'coffee' },
      { name: 'Iced Coffee', icon: 'cup-soda' },
      { name: 'Dessert', icon: 'cookie' },
    ],
    products: [
      { name: 'Espresso', category: 'Hot Coffee', base_price: 18000, stock_qty: 30 },
      { name: 'Iced Spanish Latte', category: 'Iced Coffee', base_price: 35000, stock_qty: 30 },
      { name: 'Macarons', category: 'Dessert', base_price: 32000, stock_qty: 20 },
    ],
  },
  retail: {
    categories: [
      { name: 'Minuman', icon: 'cup-soda' },
      { name: 'Makanan Ringan', icon: 'cookie' },
      { name: 'Sembako', icon: 'utensils' },
    ],
    products: [
      { name: 'Indomie Goreng', category: 'Sembako', base_price: 3500, cost_price: 2800, stock_qty: 100 },
      { name: 'Teh Botol Sosro', category: 'Minuman', base_price: 5000, cost_price: 4000, stock_qty: 50 },
      { name: 'Oreo Original', category: 'Makanan Ringan', base_price: 9000, cost_price: 7000, stock_qty: 25 },
    ],
  },
  bakery: {
    categories: [
      { name: 'Roti', icon: 'donut' },
      { name: 'Pastry', icon: 'cookie' },
      { name: 'Kue', icon: 'cake' },
    ],
    products: [
      { name: 'Croissant', category: 'Pastry', base_price: 18000, cost_price: 9000, stock_qty: 40 },
      { name: 'Roti Tawar', category: 'Roti', base_price: 25000, cost_price: 14000, stock_qty: 20 },
      { name: 'Brownies Slice', category: 'Kue', base_price: 15000, cost_price: 8000, stock_qty: 25 },
    ],
  },
  service: {
    categories: [
      { name: 'Potong Rambut', icon: 'scissors' },
      { name: 'Treatment', icon: 'leaf' },
      { name: 'Produk', icon: 'shopping-bag' },
    ],
    products: [
      { name: 'Potong Rambut Pria', category: 'Potong Rambut', base_price: 50000, track_stock: false },
      { name: 'Creambath', category: 'Treatment', base_price: 90000, track_stock: false },
      { name: 'Hair Tonic 100ml', category: 'Produk', base_price: 70000, cost_price: 45000, stock_qty: 12 },
    ],
  },
};

async function main() {
  const options = readOptions();
  const pool = new Pool({
    connectionString: options.databaseUrl,
    ssl: parseBool(process.env.DB_SSL) ? { rejectUnauthorized: false } : undefined,
  });

  const client = await pool.connect();
  try {
    await client.query('begin');

    const userResult = await ensureUser(client, options);
    const store = await ensureStore(client, options, userResult.user.id);
    await ensureProfile(client, options, userResult.user, store.id);
    const seeded = options.seedSample
      ? await seedSampleData(client, store.id, options.industry)
      : false;

    await client.query('commit');
    console.log(`Bootstrap selesai: ${userResult.user.email}`);
    console.log(`Store: ${store.name} (${store.id})`);
    console.log(`Password: ${userResult.passwordChanged ? 'dibuat/direset' : 'tidak diubah'}`);
    console.log(`Produk contoh: ${seeded ? 'ditambahkan' : 'dilewati'}`);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function readOptions() {
  const databaseUrl = requiredEnv('DATABASE_URL');
  const email = normalizeEmail(requiredEnv('BOOTSTRAP_ADMIN_EMAIL'));
  const password = requiredEnv('BOOTSTRAP_ADMIN_PASSWORD');
  const storeName = requiredEnv('BOOTSTRAP_STORE_NAME').trim();
  const industry = String(process.env.BOOTSTRAP_INDUSTRY ?? 'fnb').trim().toLowerCase();
  const storeId = String(process.env.BOOTSTRAP_STORE_ID ?? '').trim();

  if (!email) throw new Error('BOOTSTRAP_ADMIN_EMAIL tidak valid.');
  if (password.length < 6) throw new Error('BOOTSTRAP_ADMIN_PASSWORD minimal 6 karakter.');
  if (!storeName) throw new Error('BOOTSTRAP_STORE_NAME wajib diisi.');
  if (!Object.hasOwn(INDUSTRY_FEATURES, industry)) {
    throw new Error('BOOTSTRAP_INDUSTRY harus salah satu: fnb, retail, bakery, service.');
  }
  if (storeId && !isUuid(storeId)) throw new Error('BOOTSTRAP_STORE_ID harus UUID valid.');

  return {
    databaseUrl,
    email,
    password,
    storeName,
    storeAddress: String(process.env.BOOTSTRAP_STORE_ADDRESS ?? '').trim() || null,
    adminName: String(process.env.BOOTSTRAP_ADMIN_NAME ?? '').trim() || email.split('@')[0],
    currency: String(process.env.BOOTSTRAP_CURRENCY ?? 'IDR').trim() || 'IDR',
    taxRate: parseNumber(process.env.BOOTSTRAP_TAX_RATE, industry === 'fnb' ? 10 : 0),
    lowStockThreshold: parseNumber(process.env.BOOTSTRAP_LOW_STOCK_THRESHOLD, 5),
    pointsPerAmount: parseNumber(process.env.BOOTSTRAP_POINTS_PER_AMOUNT, 0),
    industry,
    features: INDUSTRY_FEATURES[industry],
    resetPassword: parseBool(process.env.BOOTSTRAP_RESET_PASSWORD),
    seedSample: parseBool(process.env.BOOTSTRAP_SEED_SAMPLE),
    storeId: storeId || null,
  };
}

async function ensureUser(client, options) {
  const existing = await client.query(
    'select id, email from public.app_users where lower(email) = lower($1) limit 1',
    [options.email],
  );

  if (existing.rows[0]) {
    if (options.resetPassword) {
      await client.query(
        'update public.app_users set password_hash = $1 where id = $2',
        [await hashPassword(options.password), existing.rows[0].id],
      );
    }
    return { user: existing.rows[0], passwordChanged: options.resetPassword };
  }

  const created = await client.query(
    `
      insert into public.app_users(email, password_hash)
      values ($1, $2)
      returning id, email
    `,
    [options.email, await hashPassword(options.password)],
  );
  return { user: created.rows[0], passwordChanged: true };
}

async function ensureStore(client, options, userId) {
  const profileStore = await client.query(
    'select store_id from public.profiles where id = $1 and store_id is not null limit 1',
    [userId],
  );
  const storeId = options.storeId ?? profileStore.rows[0]?.store_id ?? null;

  if (storeId) {
    const updated = await updateStore(client, storeId, options);
    if (updated) return updated;
    if (!options.storeId) {
      throw new Error(`Profile mengarah ke store_id ${storeId}, tetapi store tidak ditemukan.`);
    }
    return insertStore(client, options, storeId);
  }

  return insertStore(client, options, null);
}

async function insertStore(client, options, storeId) {
  const columns = [
    ...(storeId ? ['id'] : []),
    'name',
    'address',
    'currency',
    'tax_rate',
    'industry',
    'features',
    'low_stock_threshold',
    'points_per_amount',
  ];
  const params = [
    ...(storeId ? [storeId] : []),
    options.storeName,
    options.storeAddress,
    options.currency,
    options.taxRate,
    options.industry,
    JSON.stringify(options.features),
    options.lowStockThreshold,
    options.pointsPerAmount,
  ];
  const featureParamIndex = storeId ? 6 : 5;
  const values = params
    .map((_, index) => (index === featureParamIndex ? `$${index + 1}::jsonb` : `$${index + 1}`))
    .join(', ');
  const result = await client.query(
    `
      insert into public.stores(${columns.join(', ')})
      values (${values})
      returning id, name
    `,
    params,
  );
  return result.rows[0];
}

async function updateStore(client, storeId, options) {
  const result = await client.query(
    `
      update public.stores
      set name = $2,
          address = $3,
          currency = $4,
          tax_rate = $5,
          industry = $6,
          features = $7::jsonb,
          low_stock_threshold = $8,
          points_per_amount = $9
      where id = $1
      returning id, name
    `,
    [
      storeId,
      options.storeName,
      options.storeAddress,
      options.currency,
      options.taxRate,
      options.industry,
      JSON.stringify(options.features),
      options.lowStockThreshold,
      options.pointsPerAmount,
    ],
  );
  return result.rows[0] ?? null;
}

async function ensureProfile(client, options, user, storeId) {
  await client.query(
    `
      insert into public.profiles(id, store_id, full_name, email, role)
      values ($1, $2, $3, $4, 'admin')
      on conflict (id) do update
      set store_id = excluded.store_id,
          full_name = excluded.full_name,
          email = excluded.email,
          role = 'admin'
    `,
    [user.id, storeId, options.adminName, user.email],
  );
}

async function seedSampleData(client, storeId, industry) {
  const existing = await client.query(
    'select 1 from public.products where store_id = $1 limit 1',
    [storeId],
  );
  if (existing.rowCount) return false;

  const seed = SAMPLE_DATA[industry] ?? SAMPLE_DATA.fnb;
  const categoryIds = new Map();

  for (const [index, category] of seed.categories.entries()) {
    const result = await client.query(
      `
        insert into public.categories(store_id, name, icon, sort_order)
        values ($1, $2, $3, $4)
        returning id
      `,
      [storeId, category.name, category.icon, index],
    );
    categoryIds.set(category.name, result.rows[0].id);
  }

  for (const product of seed.products) {
    await client.query(
      `
        insert into public.products(
          store_id, category_id, name, base_price, cost_price,
          stock_qty, min_stock, track_stock
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        storeId,
        categoryIds.get(product.category) ?? null,
        product.name,
        product.base_price,
        product.cost_price ?? 0,
        product.stock_qty ?? 0,
        5,
        product.track_stock ?? true,
      ],
    );
  }

  return true;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${Buffer.from(key).toString('hex')}`;
}

function requiredEnv(key) {
  const value = String(process.env[key] ?? '').trim();
  if (!value) throw new Error(`${key} wajib diisi.`);
  return value;
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function parseNumber(value, fallback) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBool(value) {
  return /^(1|true|yes)$/i.test(String(value ?? ''));
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function loadEnvFile(filename) {
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), filename), 'utf8');
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
