// Data contoh untuk merender setiap keadaan layar affiliate (wireframe dan QC).
// Hanya dipakai lewat `?fixture=` di mode pengembangan; produksi tidak memuatnya.
import type {
  AcquisitionRow,
  AdminCommissionRow,
  AdminMemberRow,
  AdminOverview,
  AffiliateCharts,
  AffiliateCommissionRow,
  AffiliateInvitations,
  AffiliateMe,
  AffiliateNetwork,
  AffiliateOrderRow,
  AffiliateProduct,
  AffiliateSettings,
  CommissionTotals,
  PayoutHistoryRow,
  PayoutSummaryRow,
} from './affiliate';

export interface AffiliateFixture {
  me: AffiliateMe;
  charts: AffiliateCharts;
  acquisition: AcquisitionRow[];
  products: AffiliateProduct[];
  orders: AffiliateOrderRow[];
  commissions: { totals: CommissionTotals; rows: AffiliateCommissionRow[] };
  network: AffiliateNetwork;
  invitations: AffiliateInvitations;
}

const NOL = { clicks: 0, leads: 0, sales: 0, omset: 0, commission: 0 };
const PLATFORM = [
  { key: 'fb', label: 'Facebook' },
  { key: 'ins', label: 'Instagram' },
  { key: 'insto', label: 'Instagram Story' },
  { key: 'what', label: 'WhatsApp' },
  { key: 'email', label: 'Email' },
  { key: 'line', label: 'Line' },
  { key: 'tiktok', label: 'TikTok' },
];
const SETTINGS = {
  cookie_days: 30,
  platforms: PLATFORM,
  invite_days: 7,
  invite_daily_limit: 20,
  show_buyer_contact: false,
  show_downline_contact: false,
  downline_depth: 2,
};

const PRODUK: AffiliateProduct[] = [
  { id: 'b9a1d3f0-0000-4000-8000-000000000001', name: 'Gear Set Honda Crf150 Red GNNK Racing Product', variant_label: 'SETCRF-12-46-R', sku: 'SETCRF-12-46-R', price: 655000, eligible: true },
  { id: 'b9a1d3f0-0000-4000-8000-000000000002', name: 'Gear Set Kawasaki Klx150 Blue GNNK Racing Product', variant_label: null, sku: 'SETKLX-13-42-B', price: 655000, eligible: true },
  { id: 'b9a1d3f0-0000-4000-8000-000000000003', name: 'Gear Belakang Yamaha Fiz R Rx King Black GNNK Racing Product', variant_label: 'Gb-415-33F-Black', sku: 'Gb-415-33F-Black', price: 175000, eligible: true },
  { id: 'b9a1d3f0-0000-4000-8000-000000000004', name: 'Gear Depan Yamaha Fiz R Rx King GNNK Racing Product', variant_label: 'Gd-415-13-FIZ', sku: 'Gd-415-13-FIZ', price: 50000, eligible: true },
];

export const FIXTURE_AFFILIATE: Record<string, AffiliateFixture> = {
  ringkasan: {
    me: {
      eligible: true,
      profile: { code: 'ANDI24', name: 'Andi Saputra', bank_info: 'BCA 1234567890 a.n. Andi Saputra', upline_name: 'Budi Santoso' },
      settings: SETTINGS,
      summary: {
        today: { clicks: 14, leads: 2, sales: 1, omset: 655000, commission: 65500 },
        month: { clicks: 236, leads: 19, sales: 11, omset: 6420000, commission: 642000 },
        all: { clicks: 1184, leads: 87, sales: 52, omset: 31275000, commission: 3127500 },
      },
    },
    charts: {
      month: Array.from({ length: 11 }, (_, i) => ({
        key: `2026-10-${String(i + 1).padStart(2, '0')}`,
        sales: [1, 0, 2, 1, 0, 0, 3, 1, 2, 0, 1][i],
        omset: [655000, 0, 830000, 175000, 0, 0, 1965000, 655000, 1310000, 0, 830000][i],
      })),
      year: Array.from({ length: 10 }, (_, i) => ({
        key: `2026-${String(i + 1).padStart(2, '0')}`,
        sales: [0, 0, 0, 0, 0, 0, 4, 15, 22, 11][i],
        omset: [0, 0, 0, 0, 0, 0, 2620000, 8840000, 13395000, 6420000][i],
      })),
    },
    acquisition: [
      { source: 'fb', label: 'Facebook', media: 'grup-crf-jatim', views: 512, leads: 31, sales: 19, value: 11835000 },
      { source: 'insto', label: 'Instagram Story', media: 'story-okt', views: 288, leads: 17, sales: 9, value: 5245000 },
      { source: 'what', label: 'WhatsApp', media: 'status', views: 201, leads: 22, sales: 15, value: 8910000 },
      { source: '', label: 'Langsung', media: '', views: 183, leads: 17, sales: 9, value: 5285000 },
    ],
    products: PRODUK,
    orders: [
      { order_number: 'WEB-MUWHOD1CE5FA', created_at: '2026-10-11T09:41:00Z', buyer_name: 'Rizky Pratama', items_value: 655000, status: 'menunggu', commission: 65500 },
      { order_number: 'WEB-MUQ8X21LKZ0A', created_at: '2026-10-09T03:12:00Z', buyer_name: 'Dewi Lestari', items_value: 830000, status: 'selesai', commission: 83000 },
      { order_number: 'WEB-MUN4C7TTQ9PE', created_at: '2026-10-07T14:55:00Z', buyer_name: 'Hendra Gunawan', items_value: 175000, status: 'dibatalkan', commission: 17500 },
      { order_number: 'WEB-MUL0Z9AA31BC', created_at: '2026-10-04T08:20:00Z', buyer_name: 'Siti Nurhaliza', items_value: 1310000, status: 'selesai', commission: 131000 },
    ],
    commissions: {
      totals: { pending: 65500, unpaid: 214000, paid: 2848000 },
      rows: [
        { id: 'k1', created_at: '2026-10-11T09:41:00Z', order_number: 'WEB-MUWHOD1CE5FA', product_name: 'Gear Set Honda Crf150 Red GNNK Racing Product', tier: 1, commission: 65500, status: 'pending', paid: false, paid_at: null },
        { id: 'k2', created_at: '2026-10-09T03:12:00Z', order_number: 'WEB-MUQ8X21LKZ0A', product_name: 'Gear Set Kawasaki Klx150 Blue GNNK Racing Product', tier: 1, commission: 65500, status: 'added', paid: false, paid_at: null },
        { id: 'k3', created_at: '2026-10-09T03:12:00Z', order_number: 'WEB-MUQ8X21LKZ0A', product_name: 'Gear Belakang Yamaha Fiz R Rx King Black GNNK Racing Product', tier: 1, commission: 17500, status: 'added', paid: false, paid_at: null },
        { id: 'k4', created_at: '2026-10-08T11:30:00Z', order_number: 'WEB-MUP2D88RRA1Q', product_name: 'Gear Set Honda Crf150 Red GNNK Racing Product', tier: 2, commission: 13100, status: 'added', paid: false, paid_at: null },
        { id: 'k5', created_at: '2026-10-07T14:55:00Z', order_number: 'WEB-MUN4C7TTQ9PE', product_name: 'Gear Belakang Yamaha Fiz R Rx King Black GNNK Racing Product', tier: 1, commission: 17500, status: 'cancelled', paid: false, paid_at: null },
        { id: 'k6', created_at: '2026-10-04T08:20:00Z', order_number: 'WEB-MUL0Z9AA31BC', product_name: 'Gear Set Honda Crf150 Red GNNK Racing Product', tier: 1, commission: 131000, status: 'added', paid: true, paid_at: '2026-10-06T10:00:00Z' },
      ],
    },
    network: {
      upline_name: 'Budi Santoso',
      nodes: [
        { id: 'n1', parent_id: null, name: 'Rizky Pratama', joined_at: '2026-09-12T02:00:00Z', downline_count: 2, depth: 1 },
        { id: 'n2', parent_id: 'n1', name: 'Fajar Nugroho', joined_at: '2026-09-20T02:00:00Z', downline_count: 0, depth: 2 },
        { id: 'n3', parent_id: 'n1', name: 'Muhammad Rizky Ramadhan Saputra Wijaya', joined_at: '2026-10-02T02:00:00Z', downline_count: 0, depth: 2 },
        { id: 'n4', parent_id: null, name: 'Dewi Lestari', joined_at: '2026-09-28T02:00:00Z', downline_count: 0, depth: 1 },
      ],
    },
    invitations: {
      sent_today: 3,
      daily_limit: 20,
      rows: [
        { id: 'u1', email: 'rizky.pratama@gmail.com', name: 'Rizky', status: 'registered', sent_at: '2026-09-11T02:00:00Z', opened_at: '2026-09-11T05:00:00Z', expires_at: '2026-09-18T02:00:00Z', can_resend: false },
        { id: 'u2', email: 'teman.bengkel.surabaya@yahoo.co.id', name: null, status: 'opened', sent_at: '2026-10-09T02:00:00Z', opened_at: '2026-10-09T07:30:00Z', expires_at: '2026-10-16T02:00:00Z', can_resend: true },
        { id: 'u3', email: 'hendra.g@gmail.com', name: 'Hendra', status: 'sent', sent_at: '2026-10-11T01:00:00Z', opened_at: null, expires_at: '2026-10-18T01:00:00Z', can_resend: false },
        { id: 'u4', email: 'lama@gmail.com', name: null, status: 'expired', sent_at: '2026-09-01T02:00:00Z', opened_at: null, expires_at: '2026-09-08T02:00:00Z', can_resend: true },
      ],
    },
  },
  kosong: {
    me: {
      eligible: true,
      profile: { code: 'SITI07', name: 'Siti Nurhaliza', bank_info: null, upline_name: null },
      settings: SETTINGS,
      summary: { today: NOL, month: NOL, all: NOL },
    },
    charts: { month: [], year: [] },
    acquisition: [],
    products: PRODUK,
    orders: [],
    commissions: { totals: { pending: 0, unpaid: 0, paid: 0 }, rows: [] },
    network: { upline_name: null, nodes: [] },
    invitations: { sent_today: 0, daily_limit: 20, rows: [] },
  },
};

FIXTURE_AFFILIATE['tanpa-akses'] = {
  ...FIXTURE_AFFILIATE.kosong,
  me: { eligible: false, reason: 'no_access', message: 'Halaman ini hanya bisa diakses jika anda memiliki fitur affiliasi.' },
};
FIXTURE_AFFILIATE['program-mati'] = {
  ...FIXTURE_AFFILIATE.kosong,
  me: { eligible: false, reason: 'program_off', message: 'Halaman ini hanya bisa diakses jika anda memiliki fitur affiliasi.' },
};
FIXTURE_AFFILIATE['kontak'] = {
  ...FIXTURE_AFFILIATE.ringkasan,
  me: { ...FIXTURE_AFFILIATE.ringkasan.me, settings: { ...SETTINGS, show_buyer_contact: true, show_downline_contact: true } },
  orders: FIXTURE_AFFILIATE.ringkasan.orders.map((o, i) => ({ ...o, buyer_phone: `08123456${String(780 + i)}`, buyer_email: `${o.buyer_name.split(' ')[0].toLowerCase()}@gmail.com` })),
  network: {
    ...FIXTURE_AFFILIATE.ringkasan.network,
    nodes: FIXTURE_AFFILIATE.ringkasan.network.nodes.map((n, i) => ({ ...n, phone: `08571234${String(560 + i)}`, email: `${n.name.split(' ')[0].toLowerCase()}@gmail.com` })),
  },
};

// ---------------------------------------------------------------------------
// Admin

export const FIXTURE_SETTINGS: AffiliateSettings = {
  enabled: true,
  access_mode: 'approved',
  no_access_text: 'Halaman ini hanya bisa diakses jika anda memiliki fitur affiliasi.',
  cookie_days: 30,
  general_cookie: true,
  permanent: false,
  commission: [{ type: 'percentage', value: 10 }, { type: 'percentage', value: 2 }],
  downline_depth: 2,
  upline_depth: 1,
  show_downline_contact: false,
  show_buyer_contact: false,
  invite_days: 7,
  invite_daily_limit: 20,
  platforms: PLATFORM.map((p) => `${p.key};${p.label}`).join('\n'),
  email_new_order: true,
  email_commission: true,
  email_paid: true,
  admin_copy_emails: '',
};

export const FIXTURE_OVERVIEW: AdminOverview = {
  eligible_affiliates: 12,
  active_affiliates: 7,
  totals: { clicks: 2840, leads: 196, sales: 118, omset: 71230000, commission: 7123000, pending: 412500, unpaid: 1386000, paid: 5324500 },
  affiliates: [
    { id: 'a1', name: 'Andi Saputra', email: 'andi.saputra@gmail.com', code: 'ANDI24', clicks: 1184, leads: 87, sales: 52, omset: 31275000, commission_pending: 65500, commission_unpaid: 214000, commission_paid: 2848000 },
    { id: 'a2', name: 'Budi Santoso', email: 'budi.santoso@gmail.com', code: 'BUDI11', clicks: 802, leads: 51, sales: 33, omset: 20135000, commission_pending: 131000, commission_unpaid: 655000, commission_paid: 1227500 },
    { id: 'a3', name: 'Muhammad Rizky Ramadhan Saputra Wijaya', email: 'muhammad.rizky.ramadhan.saputra@yahoo.co.id', code: 'MUHAMM03', clicks: 455, leads: 33, sales: 20, omset: 12410000, commission_pending: 216000, commission_unpaid: 386000, commission_paid: 639000 },
    { id: 'a4', name: 'Dewi Lestari', email: 'dewi.lestari@gmail.com', code: 'DEWI08', clicks: 399, leads: 25, sales: 13, omset: 7410000, commission_pending: 0, commission_unpaid: 131000, commission_paid: 610000 },
  ],
  top_products: [
    { product_id: 'p1', name: 'Gear Set Honda Crf150 Red GNNK Racing Product', qty: 41, omset: 26855000 },
    { product_id: 'p2', name: 'Gear Set Kawasaki Klx150 Blue GNNK Racing Product', qty: 33, omset: 21615000 },
    { product_id: 'p3', name: 'Gear Belakang Yamaha Fiz R Rx King Black GNNK Racing Product', qty: 29, omset: 5075000 },
  ],
};

export const FIXTURE_ADMIN_COMMISSIONS: AdminCommissionRow[] = FIXTURE_AFFILIATE.ringkasan.commissions.rows.map((r, i) => ({
  ...r,
  order_id: `o${i}`,
  affiliate_id: i % 2 ? 'a2' : 'a1',
  affiliate_name: i % 2 ? 'Budi Santoso' : 'Andi Saputra',
  order_status: r.status === 'pending' ? 'awaiting_confirmation' : r.status === 'cancelled' ? 'canceled' : 'done',
}));

export const FIXTURE_PAYOUT_SUMMARY: PayoutSummaryRow[] = FIXTURE_OVERVIEW.affiliates.map((a, i) => ({
  affiliate_id: a.id,
  name: a.name,
  email: a.email,
  phone: `0812345678${i}`,
  bank_info: i === 3 ? null : `BCA 12345678${i}0 a.n. ${a.name}`,
  pending: a.commission_pending,
  unpaid: a.commission_unpaid,
  paid: a.commission_paid,
}));

export const FIXTURE_PAYOUT_HISTORY: PayoutHistoryRow[] = [
  { id: 'py1', affiliate_id: 'a1', affiliate_name: 'Andi Saputra', amount: 1310000, commission_count: 9, paid_at: '2026-10-06T10:00:00Z', note: 'Transfer BCA 06/10', has_proof: true, expense_id: 'e1' },
  { id: 'py2', affiliate_id: 'a2', affiliate_name: 'Budi Santoso', amount: 655000, commission_count: 5, paid_at: '2026-10-01T03:00:00Z', note: null, has_proof: false, expense_id: null },
];

export const FIXTURE_MEMBERS: AdminMemberRow[] = [
  { id: 'a1', name: 'Andi Saputra', email: 'andi.saputra@gmail.com', phone: '081234567801', code: 'ANDI24', access: 'allowed', eligible: true, upline_id: 'a2', upline_name: 'Budi Santoso', downline_count: 2, clicks: 1184, sales: 52, commission_unpaid: 214000, joined_at: '2026-08-02T02:00:00Z' },
  { id: 'a2', name: 'Budi Santoso', email: 'budi.santoso@gmail.com', phone: '081234567802', code: 'BUDI11', access: 'allowed', eligible: true, upline_id: null, upline_name: null, downline_count: 1, clicks: 802, sales: 33, commission_unpaid: 655000, joined_at: '2026-07-21T02:00:00Z' },
  { id: 'a3', name: 'Muhammad Rizky Ramadhan Saputra Wijaya', email: 'muhammad.rizky.ramadhan.saputra@yahoo.co.id', phone: '085712345603', code: 'MUHAMM03', access: 'allowed', eligible: true, upline_id: 'a1', upline_name: 'Andi Saputra', downline_count: 0, clicks: 455, sales: 20, commission_unpaid: 386000, joined_at: '2026-09-15T02:00:00Z' },
  { id: 'a5', name: 'Hendra Gunawan', email: 'hendra.g@gmail.com', phone: null, code: null, access: 'default', eligible: false, upline_id: null, upline_name: null, downline_count: 0, clicks: 0, sales: 0, commission_unpaid: 0, joined_at: '2026-10-01T02:00:00Z' },
  { id: 'a6', name: 'Joko Widodo', email: 'joko.w@gmail.com', phone: '081298765432', code: 'JOKO19', access: 'blocked', eligible: false, upline_id: null, upline_name: null, downline_count: 0, clicks: 37, sales: 1, commission_unpaid: 0, joined_at: '2026-08-11T02:00:00Z' },
];

/** Fixture aktif dari `?fixture=` (hanya di mode pengembangan). */
export function fixtureAktif(): string | null {
  if (!import.meta.env.DEV) return null;
  return new URLSearchParams(window.location.search).get('fixture');
}
