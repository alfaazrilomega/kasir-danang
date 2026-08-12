import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import express from 'express';
import pg from 'pg';
import notificationsHandler from '../api/notifications.js';

loadEnvFile('.env');
loadEnvFile('.env.local');

const { Pool, types } = pg;
const scrypt = promisify(crypto.scrypt);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

types.setTypeParser(1700, (value) => parseFloat(value));
types.setTypeParser(1082, (value) => value);

const PORT = Number(process.env.PORT || 3000);
const REQUEST_BODY_LIMIT = process.env.REQUEST_BODY_LIMIT || '25mb';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 7);
const AUTH_SECRET = process.env.AUTH_SECRET || process.env.SESSION_SECRET || '';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL belum diisi.');
  process.exit(1);
}

if (!AUTH_SECRET && process.env.NODE_ENV === 'production') {
  console.error('AUTH_SECRET wajib diisi saat NODE_ENV=production.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: parseBool(process.env.DB_SSL) ? { rejectUnauthorized: false } : undefined,
});

const authSecret = AUTH_SECRET || 'dev-only-change-me';

const TABLES = {
  stores: {
    columns: [
      'id', 'name', 'address', 'currency', 'tax_rate', 'logo_url', 'receipt_header',
      'receipt_footer', 'points_per_amount', 'low_stock_threshold', 'industry',
      'features', 'created_at',
    ],
    kind: 'store',
  },
  profiles: {
    columns: ['id', 'store_id', 'full_name', 'email', 'role', 'avatar_url', 'created_at'],
    kind: 'profile',
  },
  categories: {
    columns: ['id', 'store_id', 'name', 'icon', 'sort_order', 'created_at'],
    tenantColumn: 'store_id',
  },
  products: {
    columns: [
      'id', 'store_id', 'category_id', 'name', 'description', 'image_url',
      'base_price', 'sizes', 'is_active', 'sku', 'barcode', 'cost_price',
      'stock_qty', 'min_stock', 'track_stock', 'created_at',
    ],
    tenantColumn: 'store_id',
  },
  customers: {
    columns: [
      'id', 'store_id', 'name', 'phone', 'email', 'location', 'joined_date',
      'is_active', 'points', 'created_at',
    ],
    tenantColumn: 'store_id',
  },
  promos: {
    columns: [
      'id', 'store_id', 'code', 'name', 'type', 'value', 'start_date',
      'end_date', 'is_active', 'created_at',
    ],
    tenantColumn: 'store_id',
  },
  shifts: {
    columns: [
      'id', 'store_id', 'cashier_id', 'opened_at', 'closed_at', 'opening_cash',
      'closing_cash', 'expected_cash', 'total_sales', 'total_orders', 'notes',
      'created_at',
    ],
    tenantColumn: 'store_id',
  },
  cash_movements: {
    columns: ['id', 'store_id', 'shift_id', 'type', 'amount', 'note', 'created_at'],
    tenantColumn: 'store_id',
  },
  stock_movements: {
    columns: [
      'id', 'store_id', 'product_id', 'type', 'qty_delta', 'reason',
      'ref_order_id', 'created_at',
    ],
    tenantColumn: 'store_id',
  },
  loyalty_transactions: {
    columns: [
      'id', 'store_id', 'customer_id', 'points_delta', 'reason',
      'ref_order_id', 'created_at',
    ],
    tenantColumn: 'store_id',
  },
  orders: {
    columns: [
      'id', 'store_id', 'customer_id', 'cashier_id', 'shift_id', 'order_number',
      'subtotal', 'tax', 'discount', 'total', 'payment_method', 'payment_status',
      'order_status', 'order_type', 'table_number', 'notes', 'promo_code',
      'received_amount', 'change_amount', 'points_earned', 'created_at',
      'sales_channel', 'payment_term', 'due_date', 'paid_amount', 'settled_at',
      'original_total', 'adjustment_amount', 'adjustment_note', 'adjusted_at',
      'adjusted_by',
    ],
    tenantColumn: 'store_id',
  },
  order_items: {
    columns: ['id', 'order_id', 'product_id', 'name', 'size', 'qty', 'price', 'cost_price', 'note'],
    kind: 'order_items',
  },
  suppliers: {
    columns: [
      'id', 'store_id', 'name', 'contact_name', 'phone', 'email', 'address',
      'default_term_days', 'default_dp_percent', 'notes', 'is_active', 'created_at',
    ],
    tenantColumn: 'store_id',
  },
  purchases: {
    columns: [
      'id', 'store_id', 'supplier_id', 'invoice_number', 'status', 'order_date',
      'expected_date', 'due_date', 'subtotal', 'discount', 'tax', 'other_cost',
      'total', 'paid_amount', 'dp_percent', 'received_at', 'notes', 'created_by',
      'created_at',
    ],
    tenantColumn: 'store_id',
  },
  purchase_items: {
    columns: [
      'id', 'purchase_id', 'product_id', 'name', 'sku', 'qty', 'received_qty',
      'cost_price', 'subtotal', 'note',
    ],
    kind: 'child',
    parent: { table: 'purchases', column: 'purchase_id' },
  },
  purchase_payments: {
    columns: [
      'id', 'store_id', 'purchase_id', 'type', 'amount', 'method', 'paid_at',
      'reference', 'note', 'created_by', 'created_at',
    ],
    tenantColumn: 'store_id',
  },
  sales_channels: {
    columns: [
      'id', 'store_id', 'code', 'name', 'fee_percent', 'default_term_days',
      'is_active', 'sort_order', 'created_at',
    ],
    tenantColumn: 'store_id',
  },
  order_payments: {
    columns: [
      'id', 'store_id', 'order_id', 'amount', 'method', 'paid_at', 'reference',
      'note', 'created_by', 'created_at',
    ],
    tenantColumn: 'store_id',
  },
};

const REQUIRED_COLUMNS = {
  app_users: ['id', 'email', 'password_hash', 'created_at'],
  admin_audit_logs: [
    'id', 'store_id', 'actor_id', 'action', 'target_type',
    'target_id', 'metadata', 'created_at',
  ],
  ...Object.fromEntries(Object.entries(TABLES).map(([table, meta]) => [table, meta.columns])),
};
const REQUIRED_TABLES = Object.keys(REQUIRED_COLUMNS);
const ASSIGNABLE_ROLES = ['admin', 'warehouse', 'cashier', 'customer'];
const ALL_EFFECTIVE_ROLES = ['admin', 'warehouse', 'cashier', 'customer'];
const POS_ROLES = ['admin', 'cashier'];
const INVENTORY_ROLES = ['admin', 'warehouse'];
const TABLE_ROLE_ACCESS = {
  stores: {
    select: ALL_EFFECTIVE_ROLES,
    insert: ['admin'],
    upsert: ['admin'],
    update: ['admin'],
    delete: ['admin'],
  },
  profiles: {
    select: ALL_EFFECTIVE_ROLES,
    insert: ['admin'],
    upsert: ALL_EFFECTIVE_ROLES,
    update: ALL_EFFECTIVE_ROLES,
    delete: ['admin'],
  },
  categories: {
    select: ALL_EFFECTIVE_ROLES,
    insert: INVENTORY_ROLES,
    upsert: INVENTORY_ROLES,
    update: INVENTORY_ROLES,
    delete: INVENTORY_ROLES,
  },
  products: {
    select: ALL_EFFECTIVE_ROLES,
    insert: INVENTORY_ROLES,
    upsert: INVENTORY_ROLES,
    update: INVENTORY_ROLES,
    delete: INVENTORY_ROLES,
  },
  customers: {
    select: POS_ROLES,
    insert: POS_ROLES,
    upsert: POS_ROLES,
    update: POS_ROLES,
    delete: ['admin'],
  },
  promos: {
    select: ['admin', 'cashier', 'customer'],
    insert: ['admin'],
    upsert: ['admin'],
    update: ['admin'],
    delete: ['admin'],
  },
  shifts: {
    select: POS_ROLES,
    insert: POS_ROLES,
    upsert: POS_ROLES,
    update: POS_ROLES,
    delete: ['admin'],
  },
  cash_movements: {
    select: POS_ROLES,
    insert: POS_ROLES,
    upsert: POS_ROLES,
    update: ['admin'],
    delete: ['admin'],
  },
  stock_movements: {
    select: INVENTORY_ROLES,
    insert: INVENTORY_ROLES,
    upsert: INVENTORY_ROLES,
    update: ['admin'],
    delete: ['admin'],
  },
  loyalty_transactions: {
    select: POS_ROLES,
    insert: POS_ROLES,
    upsert: POS_ROLES,
    update: ['admin'],
    delete: ['admin'],
  },
  orders: {
    select: POS_ROLES,
    insert: POS_ROLES,
    upsert: POS_ROLES,
    update: POS_ROLES,
    delete: ['admin'],
  },
  order_items: {
    select: POS_ROLES,
    insert: POS_ROLES,
    upsert: POS_ROLES,
    update: ['admin'],
    delete: ['admin'],
  },
  suppliers: {
    select: INVENTORY_ROLES,
    insert: INVENTORY_ROLES,
    upsert: INVENTORY_ROLES,
    update: INVENTORY_ROLES,
    delete: ['admin'],
  },
  purchases: {
    select: INVENTORY_ROLES,
    insert: INVENTORY_ROLES,
    upsert: INVENTORY_ROLES,
    update: INVENTORY_ROLES,
    delete: ['admin'],
  },
  purchase_items: {
    select: INVENTORY_ROLES,
    insert: INVENTORY_ROLES,
    upsert: INVENTORY_ROLES,
    update: INVENTORY_ROLES,
    delete: INVENTORY_ROLES,
  },
  // Pembayaran ke supplier menyangkut uang keluar — hanya admin yang boleh mencatat.
  purchase_payments: {
    select: INVENTORY_ROLES,
    insert: ['admin'],
    upsert: ['admin'],
    update: ['admin'],
    delete: ['admin'],
  },
  sales_channels: {
    select: ALL_EFFECTIVE_ROLES,
    insert: ['admin'],
    upsert: ['admin'],
    update: ['admin'],
    delete: ['admin'],
  },
  // Pelunasan piutang penjualan — kasir boleh melihat, hanya admin yang mencatat.
  order_payments: {
    select: POS_ROLES,
    insert: ['admin'],
    upsert: ['admin'],
    update: ['admin'],
    delete: ['admin'],
  },
};

app.disable('x-powered-by');
app.use(corsMiddleware);
app.use(express.json({ limit: REQUEST_BODY_LIMIT }));

app.get('/api/health', asyncHandler(async (_req, res) => {
  await pool.query('select 1');
  const existing = await pool.query(
    `
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name = any($1::text[])
    `,
    [REQUIRED_TABLES],
  );
  const found = new Set(existing.rows.map((row) => row.table_name));
  const missing = REQUIRED_TABLES.filter((table) => !found.has(table));
  if (missing.length) throw new HttpError(500, `Missing tables: ${missing.join(', ')}`);

  const columnRes = await pool.query(
    `
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = any($1::text[])
    `,
    [REQUIRED_TABLES],
  );
  const columnsByTable = new Map();
  for (const row of columnRes.rows) {
    if (!columnsByTable.has(row.table_name)) columnsByTable.set(row.table_name, new Set());
    columnsByTable.get(row.table_name).add(row.column_name);
  }
  const missingColumns = [];
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const existingColumns = columnsByTable.get(table) ?? new Set();
    for (const column of columns) {
      if (!existingColumns.has(column)) missingColumns.push(`${table}.${column}`);
    }
  }
  if (missingColumns.length) throw new HttpError(500, `Missing columns: ${missingColumns.join(', ')}`);

  for (const signature of ['public.apply_order_stock(uuid)', 'public.receive_purchase(uuid)']) {
    const fn = await pool.query('select to_regprocedure($1) as fn', [signature]);
    if (!fn.rows[0]?.fn) throw new HttpError(500, `Missing function: ${signature}`);
  }

  res.json({ ok: true, database: 'postgres' });
}));

app.post('/api/auth/signup', asyncHandler(async (req, res) => {
  if (!parseBool(process.env.ALLOW_PUBLIC_SIGNUP)) {
    throw new HttpError(403, 'Signup publik dinonaktifkan. Admin harus membuat user dari menu Users.');
  }
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  const fullName = String(req.body?.full_name ?? '').trim() || email;

  if (!email) throw new HttpError(400, 'Email wajib diisi.');
  if (password.length < 6) throw new HttpError(400, 'Password minimal 6 karakter.');

  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const userRes = await client.query(
      `
        insert into public.app_users(email, password_hash)
        values ($1, $2)
        returning id, email
      `,
      [email, passwordHash],
    );
    const user = userRes.rows[0];
    await client.query(
      `
        insert into public.profiles(id, email, full_name)
        values ($1, $2, $3)
        on conflict (id) do nothing
      `,
      [user.id, user.email, fullName],
    );
    await client.query('commit');
    res.json({ user, session: createSession(user) });
  } catch (error) {
    await client.query('rollback');
    if (error?.code === '23505') throw new HttpError(400, 'User already registered');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/auth/signin', asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  if (!email || !password) throw new HttpError(400, 'Email dan password wajib diisi.');

  const result = await pool.query(
    'select id, email, password_hash from public.app_users where lower(email) = lower($1) limit 1',
    [email],
  );
  const row = result.rows[0];
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    throw new HttpError(401, 'Email atau password salah.');
  }

  const user = { id: row.id, email: row.email };
  await pool.query(
    `
      insert into public.profiles(id, email, full_name)
      values ($1, $2, $2)
      on conflict (id) do nothing
    `,
    [user.id, user.email],
  );
  res.json({ user, session: createSession(user) });
}));

app.get('/api/auth/session', requireUser, asyncHandler(async (req, res) => {
  res.json({ session: createSession(req.user, req.authToken, req.authExp) });
}));

app.get('/api/auth/user', requireUser, asyncHandler(async (req, res) => {
  res.json({ user: publicUser(req.user) });
}));

app.get('/api/admin/users', requireUser, requireRoles(['admin']), asyncHandler(async (req, res) => {
  if (!req.user.store_id) throw new HttpError(403, 'Admin belum terhubung ke toko.');
  const result = await pool.query(
    `
      select p.id, u.email, p.full_name, p.role, p.store_id, p.created_at
      from public.profiles p
      join public.app_users u on u.id = p.id
      where p.store_id = $1
      order by p.created_at desc
    `,
    [req.user.store_id],
  );
  res.json({ data: result.rows.map(publicManagedUser) });
}));

app.get('/api/admin/audit-logs', requireUser, requireRoles(['admin']), asyncHandler(async (req, res) => {
  if (!req.user.store_id) throw new HttpError(403, 'Admin belum terhubung ke toko.');
  const limit = clampInt(req.query?.limit, 100, 1, 200);
  const result = await pool.query(
    `
      select
        l.id, l.store_id, l.actor_id, l.action, l.target_type, l.target_id,
        l.metadata, l.created_at,
        au.email as actor_email,
        p.full_name as actor_name
      from public.admin_audit_logs l
      left join public.app_users au on au.id = l.actor_id
      left join public.profiles p on p.id = l.actor_id
      where l.store_id = $1
      order by l.created_at desc
      limit $2
    `,
    [req.user.store_id, limit],
  );
  res.json({ data: result.rows.map(publicAuditLog) });
}));

app.get('/api/admin/system', requireUser, requireRoles(['admin']), asyncHandler(async (req, res) => {
  if (!req.user.store_id) throw new HttpError(403, 'Admin belum terhubung ke toko.');
  const storeId = req.user.store_id;
  const [users, products, orders, shifts, audit] = await Promise.all([
    pool.query(
      `
        select case when role = 'manager' then 'admin' else role end as role, count(*)::int as count
        from public.profiles
        where store_id = $1
        group by 1
      `,
      [storeId],
    ),
    pool.query(
      `
        select
          count(*)::int as total,
          count(*) filter (where is_active)::int as active,
          count(*) filter (where track_stock and stock_qty <= min_stock and stock_qty > 0)::int as low_stock,
          count(*) filter (where track_stock and stock_qty <= 0)::int as empty
        from public.products
        where store_id = $1
      `,
      [storeId],
    ),
    pool.query(
      `
        select
          count(*) filter (where created_at >= date_trunc('day', now()))::int as today_count,
          coalesce(
            sum(total) filter (
              where created_at >= date_trunc('day', now())
                and payment_status = 'paid'
                and order_status <> 'canceled'
            ),
            0
          )::numeric as today_sales,
          count(*) filter (where payment_status = 'unpaid' and order_status <> 'canceled')::int as unpaid_count
        from public.orders
        where store_id = $1
      `,
      [storeId],
    ),
    pool.query(
      `
        select count(*) filter (where closed_at is null)::int as open
        from public.shifts
        where store_id = $1
      `,
      [storeId],
    ),
    pool.query(
      `
        select max(created_at) as latest_at
        from public.admin_audit_logs
        where store_id = $1
      `,
      [storeId],
    ),
  ]);

  res.json({
    data: publicAdminSystemStats({
      users: users.rows,
      products: products.rows[0],
      orders: orders.rows[0],
      shifts: shifts.rows[0],
      audit: audit.rows[0],
    }),
  });
}));

app.post('/api/admin/users', requireUser, requireRoles(['admin']), asyncHandler(async (req, res) => {
  if (!req.user.store_id) throw new HttpError(403, 'Admin belum terhubung ke toko.');
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  const fullName = String(req.body?.full_name ?? '').trim() || email;
  const role = normalizeAssignableRole(req.body?.role ?? 'cashier');

  if (!email) throw new HttpError(400, 'Email wajib diisi.');
  if (password.length < 6) throw new HttpError(400, 'Password minimal 6 karakter.');

  const client = await pool.connect();
  try {
    await client.query('begin');
    const userResult = await client.query(
      `
        insert into public.app_users(email, password_hash)
        values ($1, $2)
        returning id, email, created_at
      `,
      [email, await hashPassword(password)],
    );
    const user = userResult.rows[0];
    const profileResult = await client.query(
      `
        insert into public.profiles(id, store_id, full_name, email, role)
        values ($1, $2, $3, $4, $5)
        returning id, store_id, full_name, role, created_at
      `,
      [user.id, req.user.store_id, fullName, user.email, role],
    );
    await writeAdminAudit(client, req.user, 'user.create', 'profile', user.id, {
      email: user.email,
      full_name: fullName,
      role,
    });
    await client.query('commit');
    res.status(201).json({ data: publicManagedUser({ ...profileResult.rows[0], email: user.email }) });
  } catch (error) {
    await client.query('rollback');
    if (error?.code === '23505') throw new HttpError(409, 'Email sudah terdaftar.');
    throw error;
  } finally {
    client.release();
  }
}));

app.patch('/api/admin/users/:id', requireUser, requireRoles(['admin']), asyncHandler(async (req, res) => {
  if (!req.user.store_id) throw new HttpError(403, 'Admin belum terhubung ke toko.');
  const targetId = String(req.params.id ?? '');
  const email = req.body?.email === undefined ? undefined : normalizeEmail(req.body.email);
  const fullName = req.body?.full_name === undefined ? undefined : String(req.body.full_name ?? '').trim();
  const role = req.body?.role === undefined ? undefined : normalizeAssignableRole(req.body.role);
  const password = req.body?.password === undefined ? undefined : String(req.body.password ?? '');

  if (email === '') throw new HttpError(400, 'Email wajib diisi.');
  if (password !== undefined && password !== '' && password.length < 6) {
    throw new HttpError(400, 'Password minimal 6 karakter.');
  }
  if (targetId === req.user.id && role && effectiveRole(role) !== 'admin') {
    throw new HttpError(400, 'Admin tidak bisa mengubah role akun sendiri.');
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const target = await lockManagedUser(client, req.user.store_id, targetId);
    if (!target) throw new HttpError(404, 'User tidak ditemukan.');
    if (role && effectiveRole(target.role) === 'admin' && effectiveRole(role) !== 'admin') {
      await assertNotLastAdmin(client, req.user.store_id, targetId);
    }
    const auditChanges = {};
    if (email !== undefined && email !== target.email) {
      auditChanges.email = { from: target.email, to: email };
    }
    if (fullName !== undefined) {
      const nextName = fullName || email || target.email;
      if (nextName !== (target.full_name ?? '')) {
        auditChanges.full_name = { from: target.full_name ?? null, to: nextName };
      }
    }
    if (role !== undefined && role !== target.role) {
      auditChanges.role = { from: target.role, to: role };
    }
    if (password !== undefined && password !== '') {
      auditChanges.password_reset = true;
    }

    if (email !== undefined || (password !== undefined && password !== '')) {
      const sets = [];
      const params = [];
      if (email !== undefined) {
        params.push(email);
        sets.push(`email = $${params.length}`);
      }
      if (password !== undefined && password !== '') {
        params.push(await hashPassword(password));
        sets.push(`password_hash = $${params.length}`);
      }
      params.push(targetId);
      await client.query(`update public.app_users set ${sets.join(', ')} where id = $${params.length}`, params);
    }

    const profileSets = [];
    const profileParams = [];
    if (fullName !== undefined) {
      profileParams.push(fullName || email || target.email);
      profileSets.push(`full_name = $${profileParams.length}`);
    }
    if (email !== undefined) {
      profileParams.push(email);
      profileSets.push(`email = $${profileParams.length}`);
    }
    if (role !== undefined) {
      profileParams.push(role);
      profileSets.push(`role = $${profileParams.length}`);
    }
    if (profileSets.length) {
      profileParams.push(targetId);
      await client.query(
        `update public.profiles set ${profileSets.join(', ')} where id = $${profileParams.length}`,
        profileParams,
      );
    }

    const updated = await lockManagedUser(client, req.user.store_id, targetId);
    if (Object.keys(auditChanges).length) {
      await writeAdminAudit(client, req.user, 'user.update', 'profile', targetId, {
        email: updated.email,
        changes: auditChanges,
      });
    }
    await client.query('commit');
    res.json({ data: publicManagedUser(updated) });
  } catch (error) {
    await client.query('rollback');
    if (error?.code === '23505') throw new HttpError(409, 'Email sudah terdaftar.');
    throw error;
  } finally {
    client.release();
  }
}));

app.delete('/api/admin/users/:id', requireUser, requireRoles(['admin']), asyncHandler(async (req, res) => {
  if (!req.user.store_id) throw new HttpError(403, 'Admin belum terhubung ke toko.');
  const targetId = String(req.params.id ?? '');
  if (targetId === req.user.id) throw new HttpError(400, 'Admin tidak bisa menghapus akun sendiri.');

  const client = await pool.connect();
  try {
    await client.query('begin');
    const target = await lockManagedUser(client, req.user.store_id, targetId);
    if (!target) throw new HttpError(404, 'User tidak ditemukan.');
    if (effectiveRole(target.role) === 'admin') {
      await assertNotLastAdmin(client, req.user.store_id, targetId);
    }
    await writeAdminAudit(client, req.user, 'user.delete', 'profile', targetId, {
      email: target.email,
      full_name: target.full_name ?? null,
      role: target.role,
    });
    await client.query('delete from public.app_users where id = $1', [targetId]);
    await client.query('commit');
    res.json({ data: null });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/query', requireUser, asyncHandler(async (req, res) => {
  const data = await runQuery(req.user, req.body);
  res.json({ data });
}));

app.post('/api/rpc/:name', requireUser, asyncHandler(async (req, res) => {
  if (!req.user.store_id) throw new HttpError(403, 'User belum terhubung ke toko.');

  if (req.params.name === 'apply_order_stock') {
    const orderId = String(req.body?.p_order_id ?? '');
    if (!orderId) throw new HttpError(400, 'p_order_id wajib diisi.');
    assertRoleAccess(req.user, POS_ROLES, 'Role ini tidak bisa memproses stok dari order.');
    await assertOrdersBelongToStore([orderId], req.user.store_id);
    await pool.query('select public.apply_order_stock($1::uuid)', [orderId]);
    res.json({ data: null });
    return;
  }

  if (req.params.name === 'receive_purchase') {
    const purchaseId = String(req.body?.p_purchase_id ?? '');
    if (!purchaseId) throw new HttpError(400, 'p_purchase_id wajib diisi.');
    assertRoleAccess(req.user, INVENTORY_ROLES, 'Role ini tidak bisa menerima barang pembelian.');
    const owned = await pool.query(
      'select 1 from public.purchases where id = $1 and store_id = $2 limit 1',
      [purchaseId, req.user.store_id],
    );
    if (!owned.rowCount) throw new HttpError(403, 'Nota pembelian bukan milik toko aktif.');
    await pool.query('select public.receive_purchase($1::uuid)', [purchaseId]);
    res.json({ data: null });
    return;
  }

  throw new HttpError(404, `RPC ${req.params.name} tidak tersedia.`);
}));

app.all('/api/notifications', (req, res) => {
  void notificationsHandler(req, res);
});

const distPath = path.resolve(__dirname, '../dist');
if (fs.existsSync(path.join(distPath, 'index.html'))) {
  app.use(express.static(distPath, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('kasir-config.js')) {
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
      }
    },
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use(errorMiddleware);

app.listen(PORT, () => {
  console.log(`Kasir API listening on :${PORT}`);
});

async function runQuery(user, body) {
  const table = String(body?.table ?? '');
  const meta = TABLES[table];
  if (!meta) throw new HttpError(400, `Tabel "${table}" tidak tersedia.`);

  const action = String(body?.action ?? 'select');
  if (!['select', 'insert', 'upsert', 'update', 'delete'].includes(action)) {
    throw new HttpError(400, `Aksi "${action}" tidak valid.`);
  }
  assertTableAccess(user, table, action);

  if (action === 'select') return selectRows(user, table, meta, body);
  if (action === 'insert') return insertRows(user, table, meta, body);
  if (action === 'upsert') return upsertRows(user, table, meta, body);
  if (action === 'update') return updateRows(user, table, meta, body);
  return deleteRows(user, table, meta, body);
}

async function selectRows(user, table, meta, body) {
  const params = [];
  const where = [
    ...buildFilters(meta, body.filters, params),
    ...tenantWhere(table, meta, user, 'select', params),
  ];
  const columns = selectSql(meta, body.columns);
  const orderBy = orderSql(meta, body.orderBy);
  const limit = limitSql(body.limit, params);
  const sql = [
    `select ${columns} from public.${quoteIdent(table)}`,
    where.length ? `where ${where.join(' and ')}` : '',
    orderBy,
    limit,
  ].filter(Boolean).join(' ');

  const result = await pool.query(sql, params);
  if (body.single || body.maybeSingle) return result.rows[0] ?? null;
  return result.rows;
}

async function insertRows(user, table, meta, body) {
  const rows = normalizeRows(body.payload);
  await validateRowsForWrite(table, meta, rows, user);
  if (!rows.length) return body.returning ? [] : null;

  const { sql, params } = buildInsert(table, meta, rows, body.returning ? selectSql(meta, body.columns) : '');
  const result = await pool.query(sql, params);
  return body.returning ? result.rows : null;
}

async function upsertRows(user, table, meta, body) {
  const rows = normalizeRows(body.payload);
  await validateRowsForWrite(table, meta, rows, user);
  for (const row of rows) {
    if (!row.id) throw new HttpError(400, 'Upsert membutuhkan kolom id.');
  }
  if (!rows.length) return body.returning ? [] : null;

  const { sql, params } = buildUpsert(table, meta, rows, body.returning ? selectSql(meta, body.columns) : '');
  const result = await pool.query(sql, params);
  return body.returning ? result.rows : null;
}

async function updateRows(user, table, meta, body) {
  const patch = cleanRow(meta, body.payload ?? {}, { update: true });
  const columns = Object.keys(patch);
  if (!columns.length) return null;
  await validatePatchForUpdate(table, patch, user);

  const params = [];
  const setSql = columns.map((column) => {
    params.push(patch[column]);
    return `${quoteIdent(column)} = $${params.length}`;
  }).join(', ');
  const where = [
    ...buildFilters(meta, body.filters, params),
    ...tenantWhere(table, meta, user, 'update', params),
  ];
  if (!where.length) throw new HttpError(400, 'Update membutuhkan filter.');

  const returning = body.returning ? ` returning ${selectSql(meta, body.columns)}` : '';
  const sql = `update public.${quoteIdent(table)} set ${setSql} where ${where.join(' and ')}${returning}`;
  const result = await pool.query(sql, params);
  return body.returning ? result.rows : null;
}

async function deleteRows(user, table, meta, body) {
  const params = [];
  const where = [
    ...buildFilters(meta, body.filters, params),
    ...tenantWhere(table, meta, user, 'delete', params),
  ];
  if (!where.length) throw new HttpError(400, 'Delete membutuhkan filter.');

  const returning = body.returning ? ` returning ${selectSql(meta, body.columns)}` : '';
  const sql = `delete from public.${quoteIdent(table)} where ${where.join(' and ')}${returning}`;
  const result = await pool.query(sql, params);
  return body.returning ? result.rows : null;
}

function buildInsert(table, meta, rawRows, returningSql) {
  const rows = rawRows.map((row) => cleanRow(meta, row));
  const columns = unionColumns(rows);
  if (!columns.length) throw new HttpError(400, 'Payload insert kosong.');

  const params = [];
  const values = rows.map((row) => {
    const cells = columns.map((column) => {
      if (row[column] === undefined) return 'default';
      params.push(row[column]);
      return `$${params.length}`;
    });
    return `(${cells.join(', ')})`;
  });
  const returning = returningSql ? ` returning ${returningSql}` : '';
  const sql = `
    insert into public.${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')})
    values ${values.join(', ')}
    ${returning}
  `;
  return { sql, params };
}

function buildUpsert(table, meta, rawRows, returningSql) {
  const rows = rawRows.map((row) => cleanRow(meta, row));
  const columns = unionColumns(rows);
  const updateColumns = columns.filter((column) => column !== 'id');
  const params = [];
  const values = rows.map((row) => {
    const cells = columns.map((column) => {
      if (row[column] === undefined) return 'default';
      params.push(row[column]);
      return `$${params.length}`;
    });
    return `(${cells.join(', ')})`;
  });
  const conflict = updateColumns.length
    ? `do update set ${updateColumns.map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`).join(', ')}`
    : 'do nothing';
  const returning = returningSql ? ` returning ${returningSql}` : '';
  const sql = `
    insert into public.${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')})
    values ${values.join(', ')}
    on conflict (id) ${conflict}
    ${returning}
  `;
  return { sql, params };
}

function buildFilters(meta, filters, params) {
  if (!Array.isArray(filters)) return [];
  const clauses = [];
  for (const filter of filters) {
    const column = String(filter?.column ?? '');
    assertColumn(meta, column);
    if (filter.type === 'eq') {
      if (filter.value === null) {
        clauses.push(`${quoteIdent(column)} is null`);
      } else {
        params.push(filter.value);
        clauses.push(`${quoteIdent(column)} = $${params.length}`);
      }
    } else if (filter.type === 'in') {
      const values = Array.isArray(filter.values) ? filter.values : [];
      if (!values.length) clauses.push('false');
      else {
        params.push(values);
        clauses.push(`${quoteIdent(column)} = any($${params.length})`);
      }
    } else {
      throw new HttpError(400, `Filter "${filter.type}" tidak didukung.`);
    }
  }
  return clauses;
}

function tenantWhere(table, meta, user, action, params) {
  const role = effectiveRole(user.role);
  if (meta.kind === 'store') {
    if (action === 'insert') return [];
    if (!user.store_id) throw new HttpError(403, 'User belum terhubung ke toko.');
    params.push(user.store_id);
    return [`id = $${params.length}`];
  }

  if (meta.kind === 'profile') {
    params.push(user.id);
    const own = `id = $${params.length}`;
    if (action === 'select' && user.store_id) {
      params.push(user.store_id);
      return [`(${own} or store_id = $${params.length})`];
    }
    return [own];
  }

  if (meta.kind === 'order_items') {
    if (!user.store_id) throw new HttpError(403, 'User belum terhubung ke toko.');
    params.push(user.store_id);
    const storeParam = params.length;
    const cashierClause = role === 'cashier'
      ? (() => {
          params.push(user.id);
          return ` and o.cashier_id = $${params.length}`;
        })()
      : '';
    return [
      `exists (
        select 1 from public.orders o
        where o.id = ${quoteIdent(table)}.${quoteIdent('order_id')}
          and o.store_id = $${storeParam}
          ${cashierClause}
      )`,
    ];
  }

  // Tabel anak (mis. purchase_items) ikut tenant lewat induknya.
  if (meta.kind === 'child') {
    if (!user.store_id) throw new HttpError(403, 'User belum terhubung ke toko.');
    params.push(user.store_id);
    return [
      `exists (
        select 1 from public.${meta.parent.table} parent
        where parent.id = ${quoteIdent(table)}.${quoteIdent(meta.parent.column)}
          and parent.store_id = $${params.length}
      )`,
    ];
  }

  if (meta.tenantColumn) {
    if (!user.store_id) throw new HttpError(403, 'User belum terhubung ke toko.');
    params.push(user.store_id);
    const clauses = [`${quoteIdent(meta.tenantColumn)} = $${params.length}`];
    if (role === 'cashier' && (table === 'orders' || table === 'shifts')) {
      params.push(user.id);
      clauses.push(`${quoteIdent('cashier_id')} = $${params.length}`);
    }
    if (role === 'cashier' && table === 'cash_movements') {
      params.push(user.id);
      clauses.push(
        `exists (
          select 1 from public.shifts s
          where s.id = ${quoteIdent(table)}.${quoteIdent('shift_id')}
            and s.cashier_id = $${params.length}
        )`,
      );
    }
    return clauses;
  }

  return [];
}

async function validateRowsForWrite(table, meta, rows, user) {
  if (!rows.length) return;
  const role = effectiveRole(user.role);

  if (meta.kind === 'profile') {
    for (const row of rows) {
      if (row.id !== user.id) throw new HttpError(403, 'Profil hanya bisa diubah oleh pemilik akun.');
      if (row.store_id && user.store_id && row.store_id !== user.store_id) {
        throw new HttpError(403, 'Profil tidak boleh dipindahkan ke toko lain.');
      }
      if (row.role && user.store_id && row.role !== user.role) {
        throw new HttpError(403, 'Role tidak bisa diubah dari profil sendiri.');
      }
      if (row.store_id && !user.store_id) {
        const existingMembers = await pool.query(
          'select 1 from public.profiles where store_id = $1 and id <> $2 limit 1',
          [row.store_id, user.id],
        );
        if (existingMembers.rowCount) {
          throw new HttpError(403, 'Toko ini sudah memiliki anggota. Minta admin menambahkan akun Anda.');
        }
      }
    }
    return;
  }

  if (meta.kind === 'store') return;

  if (meta.kind === 'order_items') {
    if (!user.store_id) throw new HttpError(403, 'User belum terhubung ke toko.');
    const orderIds = [...new Set(rows.map((row) => row.order_id).filter(Boolean))];
    if (orderIds.length !== rows.length) throw new HttpError(400, 'order_id wajib diisi.');
    await assertOrdersBelongToStore(orderIds, user.store_id);
    if (role === 'cashier') await assertOrdersBelongToCashier(orderIds, user.id);
    return;
  }

  if (meta.kind === 'child') {
    if (!user.store_id) throw new HttpError(403, 'User belum terhubung ke toko.');
    const parentIds = [...new Set(rows.map((row) => row[meta.parent.column]).filter(Boolean))];
    if (parentIds.length === 0) throw new HttpError(400, `${meta.parent.column} wajib diisi.`);
    const result = await pool.query(
      `select id from public.${meta.parent.table} where id = any($1::uuid[]) and store_id = $2`,
      [parentIds, user.store_id],
    );
    if (result.rowCount !== parentIds.length) {
      throw new HttpError(403, 'Data induk bukan milik toko aktif.');
    }
    return;
  }

  if (meta.tenantColumn) {
    if (!user.store_id) throw new HttpError(403, 'User belum terhubung ke toko.');
    for (const row of rows) {
      if (row[meta.tenantColumn] !== user.store_id) {
        throw new HttpError(403, 'Data toko tidak cocok dengan user yang login.');
      }
      if (role === 'cashier' && table === 'orders' && row.cashier_id !== user.id) {
        throw new HttpError(403, 'Kasir hanya bisa membuat order atas nama sendiri.');
      }
      if (role === 'cashier' && table === 'shifts' && row.cashier_id !== user.id) {
        throw new HttpError(403, 'Kasir hanya bisa mengelola shift sendiri.');
      }
      if (role === 'cashier' && table === 'cash_movements' && row.shift_id) {
        await assertShiftBelongsToCashier(row.shift_id, user.id, user.store_id);
      }
    }
  }
}

async function validatePatchForUpdate(table, patch, user) {
  const role = effectiveRole(user.role);
  if (table === 'profiles' && ('role' in patch || 'store_id' in patch)) {
    throw new HttpError(403, 'Role dan toko user hanya bisa diubah dari menu Users oleh admin.');
  }
  if (role === 'cashier' && table === 'orders' && patch.cashier_id && patch.cashier_id !== user.id) {
    throw new HttpError(403, 'Kasir hanya bisa mengubah order miliknya sendiri.');
  }
  if (role === 'cashier' && table === 'shifts' && patch.cashier_id && patch.cashier_id !== user.id) {
    throw new HttpError(403, 'Kasir hanya bisa mengubah shift miliknya sendiri.');
  }
  if (role === 'cashier' && table === 'cash_movements' && patch.shift_id) {
    await assertShiftBelongsToCashier(patch.shift_id, user.id, user.store_id);
  }
}

async function assertOrdersBelongToStore(orderIds, storeId) {
  const result = await pool.query(
    'select id from public.orders where id = any($1::uuid[]) and store_id = $2',
    [orderIds, storeId],
  );
  if (result.rowCount !== orderIds.length) {
    throw new HttpError(403, 'Order bukan milik toko aktif.');
  }
}

async function assertOrdersBelongToCashier(orderIds, cashierId) {
  const result = await pool.query(
    'select id from public.orders where id = any($1::uuid[]) and cashier_id = $2',
    [orderIds, cashierId],
  );
  if (result.rowCount !== orderIds.length) {
    throw new HttpError(403, 'Order bukan milik kasir aktif.');
  }
}

async function assertShiftBelongsToCashier(shiftId, cashierId, storeId) {
  const result = await pool.query(
    'select 1 from public.shifts where id = $1 and cashier_id = $2 and store_id = $3 limit 1',
    [shiftId, cashierId, storeId],
  );
  if (!result.rowCount) throw new HttpError(403, 'Shift bukan milik kasir aktif.');
}

function cleanRow(meta, value, options = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Payload harus berupa object.');
  }
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (val === undefined) continue;
    assertColumn(meta, key);
    if (options.update && key === 'id') continue;
    out[key] = val;
  }
  return out;
}

function unionColumns(rows) {
  const set = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) set.add(key);
  }
  return [...set];
}

function normalizeRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') return [payload];
  throw new HttpError(400, 'Payload wajib diisi.');
}

function selectSql(meta, columns = '*') {
  const raw = String(columns || '*').trim();
  if (raw === '*') return meta.columns.map(quoteIdent).join(', ');
  return raw.split(',')
    .map((column) => column.trim())
    .filter(Boolean)
    .map((column) => {
      assertColumn(meta, column);
      return quoteIdent(column);
    })
    .join(', ');
}

function orderSql(meta, orderBy) {
  if (!orderBy) return '';
  const column = String(orderBy.column ?? '');
  assertColumn(meta, column);
  return `order by ${quoteIdent(column)} ${orderBy.ascending === false ? 'desc' : 'asc'}`;
}

function limitSql(limit, params) {
  if (limit == null) return '';
  const n = Number(limit);
  if (!Number.isInteger(n) || n < 0 || n > 1000) throw new HttpError(400, 'Limit tidak valid.');
  params.push(n);
  return `limit $${params.length}`;
}

function assertColumn(meta, column) {
  if (!meta.columns.includes(column)) throw new HttpError(400, `Kolom "${column}" tidak tersedia.`);
}

function quoteIdent(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new HttpError(400, `Identifier "${value}" tidak valid.`);
  return `"${value.replaceAll('"', '""')}"`;
}

function requireRoles(roles) {
  return (req, _res, next) => {
    try {
      assertRoleAccess(req.user, roles, 'Role ini tidak memiliki akses.');
      next();
    } catch (error) {
      next(error);
    }
  };
}

function assertTableAccess(user, table, action) {
  const role = effectiveRole(user.role);
  const allowed = TABLE_ROLE_ACCESS[table]?.[action] ?? [];
  if (!allowed.includes(role)) {
    throw new HttpError(403, `Role "${role}" tidak boleh ${action} tabel ${table}.`);
  }
}

function assertRoleAccess(user, roles, message) {
  const role = effectiveRole(user?.role);
  if (!roles.includes(role)) throw new HttpError(403, message);
}

function effectiveRole(role) {
  if (role === 'manager') return 'admin';
  if (role === 'admin' || role === 'warehouse' || role === 'cashier' || role === 'customer') {
    return role;
  }
  return 'cashier';
}

function normalizeAssignableRole(value) {
  const role = String(value ?? '').trim().toLowerCase();
  if (role === 'manager') return 'admin';
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw new HttpError(400, `Role harus salah satu: ${ASSIGNABLE_ROLES.join(', ')}.`);
  }
  return role;
}

function publicManagedUser(row) {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name ?? null,
    role: row.role,
    store_id: row.store_id ?? null,
    created_at: row.created_at,
  };
}

function publicAuditLog(row) {
  return {
    id: row.id,
    store_id: row.store_id,
    actor_id: row.actor_id ?? null,
    actor_email: row.actor_email ?? null,
    actor_name: row.actor_name ?? null,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id ?? null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    created_at: row.created_at,
  };
}

function publicAdminSystemStats(input) {
  const roleCounts = Object.fromEntries(ASSIGNABLE_ROLES.map((role) => [role, 0]));
  for (const row of input.users ?? []) {
    const role = String(row.role ?? '');
    if (role in roleCounts) roleCounts[role] = Number(row.count ?? 0);
  }
  return {
    users: {
      total: Object.values(roleCounts).reduce((total, count) => total + Number(count), 0),
      roles: roleCounts,
    },
    products: {
      total: Number(input.products?.total ?? 0),
      active: Number(input.products?.active ?? 0),
      low_stock: Number(input.products?.low_stock ?? 0),
      empty: Number(input.products?.empty ?? 0),
    },
    orders: {
      today_count: Number(input.orders?.today_count ?? 0),
      today_sales: Number(input.orders?.today_sales ?? 0),
      unpaid_count: Number(input.orders?.unpaid_count ?? 0),
    },
    shifts: {
      open: Number(input.shifts?.open ?? 0),
    },
    audit: {
      latest_at: input.audit?.latest_at ?? null,
    },
  };
}

async function writeAdminAudit(client, actor, action, targetType, targetId, metadata = {}) {
  if (!actor?.store_id) return;
  try {
    await client.query(
      `
        insert into public.admin_audit_logs(
          store_id, actor_id, action, target_type, target_id, metadata
        )
        values ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        actor.store_id,
        actor.id ?? null,
        action,
        targetType,
        targetId || null,
        JSON.stringify(metadata ?? {}),
      ],
    );
  } catch (error) {
    if (error?.code === '42P01') return;
    throw error;
  }
}

async function lockManagedUser(client, storeId, userId) {
  const result = await client.query(
    `
      select p.id, u.email, p.full_name, p.role, p.store_id, p.created_at
      from public.profiles p
      join public.app_users u on u.id = p.id
      where p.store_id = $1 and p.id = $2
      for update of p, u
    `,
    [storeId, userId],
  );
  return result.rows[0] ?? null;
}

async function assertNotLastAdmin(client, storeId, exceptUserId) {
  const result = await client.query(
    `
      select count(*)::int as count
      from public.profiles
      where store_id = $1
        and id <> $2
        and role in ('admin', 'manager')
    `,
    [storeId, exceptUserId],
  );
  if (Number(result.rows[0]?.count ?? 0) < 1) {
    throw new HttpError(400, 'Toko harus tetap memiliki minimal satu admin.');
  }
}

async function requireUser(req, _res, next) {
  try {
    const auth = String(req.headers.authorization ?? '');
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    if (!token) throw new HttpError(401, 'Sesi tidak ditemukan.');
    const payload = verifyToken(token);
    const result = await pool.query(
      `
        select u.id, u.email, p.store_id, p.role
        from public.app_users u
        left join public.profiles p on p.id = u.id
        where u.id = $1
        limit 1
      `,
      [payload.sub],
    );
    if (!result.rows[0]) throw new HttpError(401, 'User tidak ditemukan.');
    req.user = result.rows[0];
    req.authToken = token;
    req.authExp = payload.exp;
    next();
  } catch (error) {
    next(error);
  }
}

function createSession(user, token = createToken(user), expiresAt = undefined) {
  return {
    access_token: token,
    token_type: 'bearer',
    user: publicUser(user),
    expires_at: expiresAt ?? Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
  };
}

function publicUser(user) {
  return { id: user.id, email: user.email };
}

function createToken(user) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  return signToken({ sub: user.id, email: user.email, exp });
}

function signToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = tokenSignature(`${encodedHeader}.${encodedPayload}`);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyToken(token) {
  const [encodedHeader, encodedPayload, signature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !signature) throw new HttpError(401, 'Token tidak valid.');
  const expected = tokenSignature(`${encodedHeader}.${encodedPayload}`);
  if (!safeEqual(signature, expected)) throw new HttpError(401, 'Token tidak valid.');
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new HttpError(401, 'Sesi sudah kedaluwarsa.');
  }
  return payload;
}

function tokenSignature(value) {
  return crypto.createHmac('sha256', authSecret).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${Buffer.from(key).toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored ?? '').split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const key = await scrypt(password, salt, 64);
  return safeEqual(Buffer.from(key).toString('hex'), hash);
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function clampInt(value, fallback, min, max) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

function isAllowedOrigin(origin) {
  const configured = String(process.env.CORS_ORIGIN ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  if (configured.includes('*') || configured.includes(origin)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function errorMiddleware(error, _req, res, _next) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  if (error?.code === '23505') {
    return res.status(409).json({ error: 'Data duplikat melanggar unique constraint.' });
  }
  console.error(error);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error.'
      : error?.message ?? 'Internal server error.',
  });
}

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function parseBool(value) {
  return /^(1|true|yes)$/i.test(String(value ?? ''));
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
