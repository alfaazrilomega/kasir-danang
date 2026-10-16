// Program affiliate: bentuk data yang dipertukarkan dengan server.
//
// Perilakunya mengikuti Sejoli 1.14.7 (lihat docs/sejoli-referensi.md):
// status komisi `pending` = "Order belum selesai", `added` = "Belum dibayar"
// (atau "Sudah dibayar" bila `paid`), `cancelled` = "Dibatalkan".

import { getBackendClient } from './api';
import { panggil, type Hasil } from './customerAccount';

export type CommissionStatus = 'pending' | 'added' | 'cancelled';
export type AffiliateAccess = 'default' | 'allowed' | 'blocked';
export type InvitationStatus = 'sent' | 'opened' | 'registered' | 'failed' | 'expired';
export type ReferralSource = 'link' | 'undangan' | 'checkout' | 'admin';

export interface CommissionTier {
  type: 'percentage' | 'fixed';
  value: number;
}

/** Angka satu periode di ringkasan affiliate (definisi D-10 di PRD). */
export interface AffiliateStat {
  clicks: number;
  leads: number;
  sales: number;
  omset: number;
  commission: number;
}

export interface AffiliatePlatform {
  key: string;
  label: string;
}

export type AffiliateNoAccessReason = 'program_off' | 'no_access' | 'blocked';

export interface AffiliateMe {
  eligible: boolean;
  reason?: AffiliateNoAccessReason;
  /** Pesan pengaturan untuk member tanpa akses. */
  message?: string;
  profile?: {
    code: string;
    name: string;
    bank_info: string | null;
    upline_name: string | null;
    /** Tarif yang berlaku untuk produk tanpa komisi khusus (D-31). */
    commission: CommissionTier[];
  };
  settings?: {
    cookie_days: number;
    platforms: AffiliatePlatform[];
    invite_days: number;
    /** 0 = tanpa batas harian (D-35). */
    invite_daily_limit: number;
    downline_depth: number;
    /** 0 = tanpa minimal pencairan (D-34). */
    payout_minimum: number;
  };
  summary?: { today: AffiliateStat; month: AffiliateStat; all: AffiliateStat };
  /** Kartu target bonus bulan ini, null bila bonus mati (D-38). */
  target?: AffiliateTarget | null;
}

export interface AffiliateTarget {
  bulan: string;
  target: number;
  omset: number;
  sisa: number;
  tercapai: boolean;
  bonus_type: 'percentage' | 'fixed';
  bonus_value: number;
  bonus: number;
}

export interface AffiliateChartPoint {
  /** `YYYY-MM-DD` untuk grafik bulan ini, `YYYY-MM` untuk grafik tahun ini. */
  key: string;
  sales: number;
  omset: number;
}

export interface AffiliateCharts {
  month: AffiliateChartPoint[];
  year: AffiliateChartPoint[];
}

export interface AcquisitionRow {
  source: string;
  label: string;
  media: string;
  views: number;
  leads: number;
  sales: number;
  value: number;
}

export interface AffiliateProduct {
  id: string;
  name: string;
  variant_label: string | null;
  variant_name: string | null;
  sku: string | null;
  parent_sku: string | null;
  /** Alamat produk sekelompok varian (migrasi 054). */
  slug: string | null;
  price: number;
  eligible: boolean;
}

export type AffiliateOrderStatus = 'menunggu' | 'selesai' | 'dibatalkan';

export interface AffiliateOrderRow {
  order_number: string;
  created_at: string;
  buyer_name: string;
  items_value: number;
  /** Nilai retur pesanan ini; omset = items_value - returned_value (D-39). */
  returned_value: number;
  status: AffiliateOrderStatus;
  commission: number;
}

export interface CommissionTotals {
  pending: number;
  unpaid: number;
  paid: number;
}

/** Total di tab Komisi affiliate: komisi, bonus, dan potongan (D-36, D-38). */
export interface AffiliateCommissionTotals extends CommissionTotals {
  deductions: number;
  bonus_unpaid: number;
  bonus_running: number;
}

export interface AffiliateBonusRow {
  id: string;
  /** Hari pertama bulan, `YYYY-MM-DD`. */
  month: string;
  omset: number;
  target: number;
  amount: number;
  status: 'berjalan' | 'added';
  paid: boolean;
  paid_at: string | null;
}

export interface AffiliateDeductionRow {
  id: string;
  kind: 'retur' | 'batal';
  amount: number;
  created_at: string;
  /** Sudah dipotong dari sebuah pembayaran. */
  settled: boolean;
  order_number: string;
}

export interface AffiliateCommissionRow {
  id: string;
  created_at: string;
  order_number: string;
  product_name: string;
  tier: number;
  commission: number;
  /** Komisi sebelum dipotong retur (D-36). */
  commission_original: number;
  status: CommissionStatus;
  paid: boolean;
  paid_at: string | null;
}

export interface NetworkNode {
  id: string;
  parent_id: string | null;
  name: string;
  joined_at: string;
  downline_count: number;
  depth: number;
}

export interface AffiliateNetwork {
  upline_name: string | null;
  nodes: NetworkNode[];
}

export interface InvitationRow {
  id: string;
  email: string;
  name: string | null;
  status: InvitationStatus;
  sent_at: string;
  opened_at: string | null;
  expires_at: string;
  can_resend: boolean;
}

export interface AffiliateInvitations {
  rows: InvitationRow[];
  sent_today: number;
  daily_limit: number;
}

// ---------------------------------------------------------------------------
// Admin

export interface AffiliateSettings {
  enabled: boolean;
  access_mode: 'all' | 'approved';
  no_access_text: string;
  cookie_days: number;
  general_cookie: boolean;
  permanent: boolean;
  commission: CommissionTier[];
  downline_depth: number;
  upline_depth: number;
  invite_days: number;
  invite_daily_limit: number;
  payout_minimum: number;
  bonus_enabled: boolean;
  bonus_target: number;
  bonus_type: 'percentage' | 'fixed';
  bonus_value: number;
  platforms: string;
  email_new_order: boolean;
  email_commission: boolean;
  email_paid: boolean;
  admin_copy_emails: string;
}

export interface AdminAffiliateRow {
  id: string;
  name: string;
  email: string | null;
  code: string | null;
  clicks: number;
  leads: number;
  sales: number;
  omset: number;
  commission_pending: number;
  commission_unpaid: number;
  commission_paid: number;
}

export interface AdminOverview {
  eligible_affiliates: number;
  active_affiliates: number;
  totals: AffiliateStat & CommissionTotals;
  affiliates: AdminAffiliateRow[];
  top_products: { product_id: string; name: string; qty: number; omset: number }[];
}

export interface AdminCommissionRow extends AffiliateCommissionRow {
  order_id: string;
  affiliate_id: string;
  affiliate_name: string;
  order_status: string;
}

export interface AdminOrderAffiliate {
  affiliate: { id: string; name: string; code: string | null } | null;
  source: 'kaitan' | 'link' | 'undangan' | null;
  acquisition: { source: string; media: string | null } | null;
  commissions: AdminCommissionRow[];
}

export interface PayoutSummaryRow {
  affiliate_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  bank_info: string | null;
  pending: number;
  unpaid: number;
  paid: number;
  bonus: number;
  bonus_running: number;
  deductions: number;
  /** Yang akan ditransfer: unpaid + bonus - deductions (D-40). */
  net: number;
  below_minimum: boolean;
}

export interface PayoutHistoryRow {
  id: string;
  affiliate_id: string;
  affiliate_name: string;
  amount: number;
  commission_count: number;
  paid_at: string;
  note: string | null;
  has_proof: boolean;
  expense_id: string | null;
  commission_total: number;
  bonus_total: number;
  deduction_total: number;
}

export interface AdminInvitationRow extends InvitationRow {
  commission: CommissionTier[] | null;
  registered_name: string | null;
}

export interface AdminMemberRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  code: string | null;
  access: AffiliateAccess;
  eligible: boolean;
  upline_id: string | null;
  upline_name: string | null;
  /** Tarif khusus affiliate ini, null = ikut bawaan toko (D-31). */
  commission: CommissionTier[] | null;
  downline_count: number;
  clicks: number;
  sales: number;
  commission_unpaid: number;
  joined_at: string;
}

export const LABEL_STATUS_KOMISI: Record<CommissionStatus | 'paid', string> = {
  pending: 'Order belum selesai',
  added: 'Belum dibayar',
  paid: 'Sudah dibayar',
  cancelled: 'Dibatalkan',
};

export function statusKomisi(row: { status: CommissionStatus; paid: boolean }): CommissionStatus | 'paid' {
  return row.status === 'added' && row.paid ? 'paid' : row.status;
}

export const LABEL_STATUS_UNDANGAN: Record<InvitationStatus, string> = {
  sent: 'Terkirim',
  opened: 'Dibuka',
  registered: 'Terdaftar',
  failed: 'Gagal terkirim',
  expired: 'Kedaluwarsa',
};

export const LABEL_AKSES: Record<AffiliateAccess, string> = {
  default: 'Ikut pengaturan',
  allowed: 'Diizinkan',
  blocked: 'Diblokir',
};

/** Tarif ringkas untuk layar: "15%" atau "Rp 5.000 per barang". */
export function teksTarif(tier: CommissionTier[] | null | undefined): string | null {
  const t = tier?.[0];
  if (!t) return null;
  return t.type === 'fixed'
    ? `Rp ${new Intl.NumberFormat('id-ID').format(t.value)} per barang`
    : `${new Intl.NumberFormat('id-ID').format(t.value)}%`;
}

/** Pilihan cepat tarif affiliate (Q-1, AS-3). */
export const PRESET_TARIF = [5, 10, 15] as const;

/**
 * Link affiliate seluruh toko atau satu produk, dengan parameter akuisisi bila diisi.
 * `produk` adalah slug produk (satu link untuk semua varian, permintaan 29); id
 * produk hanya dipakai bila slug belum ada.
 */
export function linkAffiliate(origin: string, code: string, produk?: string | null, param?: { source?: string; media?: string }): string {
  const path = produk ? `/aff/${encodeURIComponent(code)}/${encodeURIComponent(produk)}` : `/aff/${encodeURIComponent(code)}`;
  const q = new URLSearchParams();
  if (param?.source) q.set('utm_source', param.source);
  if (param?.media) q.set('utm_media', param.media);
  const s = q.toString();
  return `${origin.replace(/\/+$/, '')}${path}${s ? `?${s}` : ''}`;
}

// ---------------------------------------------------------------------------
// Klien API. Sisi pembeli memakai token akun pembeli, sisi admin memakai sesi staf.


export const affiliateApi = {
  me: (token: string) => panggil<AffiliateMe>('/api/customer/affiliate', { token }),
  charts: (token: string) => panggil<AffiliateCharts>('/api/customer/affiliate/charts', { token }),
  acquisition: (token: string) => panggil<AcquisitionRow[]>('/api/customer/affiliate/acquisition', { token }),
  products: (token: string, id?: string) =>
    panggil<AffiliateProduct[]>(`/api/customer/affiliate/products${id ? `?id=${encodeURIComponent(id)}` : ''}`, { token }),
  orders: (token: string, r: RentangTanggal = {}) => panggil<AffiliateOrderRow[]>(`/api/customer/affiliate/orders${qs({ ...r })}`, { token }),
  commissions: (token: string, r: RentangTanggal = {}) =>
    panggil<{ totals: AffiliateCommissionTotals; rows: AffiliateCommissionRow[]; bonuses: AffiliateBonusRow[]; deductions: AffiliateDeductionRow[] }>(
      `/api/customer/affiliate/commissions${qs({ ...r })}`,
      { token },
    ),
  network: (token: string) => panggil<AffiliateNetwork>('/api/customer/affiliate/network', { token }),
  invitations: (token: string) => panggil<AffiliateInvitations>('/api/customer/affiliate/invitations', { token }),
  invite: (token: string, body: { email: string; name?: string; message?: string }) =>
    panggil<InvitationRow>('/api/customer/affiliate/invitations', { token, method: 'POST', body }),
  resend: (token: string, id: string) =>
    panggil<InvitationRow>(`/api/customer/affiliate/invitations/${encodeURIComponent(id)}/resend`, { token, method: 'POST', body: {} }),
  saveBank: (token: string, bank_info: string) =>
    panggil<{ bank_info: string | null }>('/api/customer/affiliate/bank', { token, method: 'PATCH', body: { bank_info } }),
  /** Membuka link affiliate: server memeriksa, mencatat klik, dan memasang cookie. */
  click: (body: { store_id: string; code: string; product_id?: string | null; utm_source?: string | null; utm_media?: string | null }, token?: string | null) =>
    panggil<{ redirect: string }>('/api/public/affiliate/click', { method: 'POST', body, token: token ?? null }),
  openInvitation: (body: { store_id: string; token: string }) =>
    panggil<{ redirect: string }>('/api/public/affiliate/invitation', { method: 'POST', body }),
};

export type { Hasil };

// ---------------------------------------------------------------------------
// Klien API admin (sesi staf).


function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export interface RentangTanggal {
  from?: string;
  to?: string;
}

export const affiliateAdminApi = {
  settings: () => getBackendClient().request<AffiliateSettings>('/api/admin/affiliate/settings'),
  saveSettings: (body: AffiliateSettings) =>
    getBackendClient().request<AffiliateSettings>('/api/admin/affiliate/settings', { method: 'PUT', body }),
  overview: (r: RentangTanggal) => getBackendClient().request<AdminOverview>(`/api/admin/affiliate/overview${qs({ ...r })}`),
  commissions: (f: RentangTanggal & { q?: string; order_status?: string; paid?: string; followup?: boolean; order_id?: string }) =>
    getBackendClient().request<AdminCommissionRow[]>(`/api/admin/affiliate/commissions${qs({ ...f })}`),
  bulkCommissions: (ids: string[], action: 'mark_paid' | 'mark_unpaid') =>
    getBackendClient().request<{ updated: number }>('/api/admin/affiliate/commissions/bulk', { method: 'POST', body: { ids, action } }),
  payoutSummary: (r: RentangTanggal) => getBackendClient().request<PayoutSummaryRow[]>(`/api/admin/affiliate/payouts/summary${qs({ ...r })}`),
  payoutHistory: () => getBackendClient().request<PayoutHistoryRow[]>('/api/admin/affiliate/payouts'),
  pay: (body: { affiliate_id: string; from?: string; to?: string; note?: string; proof_image?: string | null; record_expense: boolean; abaikan_minimal?: boolean }) =>
    getBackendClient().request<PayoutHistoryRow>('/api/admin/affiliate/payouts', { method: 'POST', body }),
  payoutProof: (id: string) => getBackendClient().request<{ proof_image: string | null }>(`/api/admin/affiliate/payouts/${encodeURIComponent(id)}/proof`),
  members: (f: { q?: string; access?: string }) => getBackendClient().request<AdminMemberRow[]>(`/api/admin/affiliate/members${qs({ ...f })}`),
  updateMember: (id: string, body: Partial<{ access: AffiliateAccess; code: string; referred_by: string | null; commission: CommissionTier[] | null }>) =>
    getBackendClient().request<AdminMemberRow>(`/api/admin/affiliate/members/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  order: (id: string) => getBackendClient().request<AdminOrderAffiliate>(`/api/admin/affiliate/order/${encodeURIComponent(id)}`),
  invitations: () => getBackendClient().request<AdminInvitationRow[]>('/api/admin/affiliate/invitations'),
  invite: (body: { email: string; name?: string; message?: string; commission: CommissionTier[] | null }) =>
    getBackendClient().request<AdminInvitationRow>('/api/admin/affiliate/invitations', { method: 'POST', body }),
  resendInvite: (id: string) =>
    getBackendClient().request<AdminInvitationRow>(`/api/admin/affiliate/invitations/${encodeURIComponent(id)}/resend`, { method: 'POST', body: {} }),
  memberNetwork: (id: string) =>
    getBackendClient().request<{ uplines: { id: string; name: string; depth: number }[]; nodes: NetworkNode[] }>(
      `/api/admin/affiliate/members/${encodeURIComponent(id)}/network`,
    ),
};
