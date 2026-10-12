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
  };
  settings?: {
    cookie_days: number;
    platforms: AffiliatePlatform[];
    invite_days: number;
    invite_daily_limit: number;
    show_buyer_contact: boolean;
    show_downline_contact: boolean;
    downline_depth: number;
  };
  summary?: { today: AffiliateStat; month: AffiliateStat; all: AffiliateStat };
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
  sku: string | null;
  price: number;
  eligible: boolean;
}

export type AffiliateOrderStatus = 'menunggu' | 'selesai' | 'dibatalkan';

export interface AffiliateOrderRow {
  order_number: string;
  created_at: string;
  buyer_name: string;
  buyer_phone?: string | null;
  buyer_email?: string | null;
  items_value: number;
  status: AffiliateOrderStatus;
  commission: number;
}

export interface CommissionTotals {
  pending: number;
  unpaid: number;
  paid: number;
}

export interface AffiliateCommissionRow {
  id: string;
  created_at: string;
  order_number: string;
  product_name: string;
  tier: number;
  commission: number;
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
  email?: string | null;
  phone?: string | null;
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
  show_downline_contact: boolean;
  show_buyer_contact: boolean;
  invite_days: number;
  invite_daily_limit: number;
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

/** Link affiliate seluruh toko atau satu produk, dengan parameter akuisisi bila diisi. */
export function linkAffiliate(origin: string, code: string, productId?: string | null, param?: { source?: string; media?: string }): string {
  const path = productId ? `/aff/${encodeURIComponent(code)}/${encodeURIComponent(productId)}` : `/aff/${encodeURIComponent(code)}`;
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
    panggil<{ totals: CommissionTotals; rows: AffiliateCommissionRow[] }>(`/api/customer/affiliate/commissions${qs({ ...r })}`, { token }),
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
  pay: (body: { affiliate_id: string; from?: string; to?: string; note?: string; proof_image?: string | null; record_expense: boolean }) =>
    getBackendClient().request<PayoutHistoryRow>('/api/admin/affiliate/payouts', { method: 'POST', body }),
  payoutProof: (id: string) => getBackendClient().request<{ proof_image: string | null }>(`/api/admin/affiliate/payouts/${encodeURIComponent(id)}/proof`),
  members: (f: { q?: string; access?: string }) => getBackendClient().request<AdminMemberRow[]>(`/api/admin/affiliate/members${qs({ ...f })}`),
  updateMember: (id: string, body: Partial<{ access: AffiliateAccess; code: string; referred_by: string | null }>) =>
    getBackendClient().request<AdminMemberRow>(`/api/admin/affiliate/members/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  order: (id: string) => getBackendClient().request<AdminOrderAffiliate>(`/api/admin/affiliate/order/${encodeURIComponent(id)}`),
  memberNetwork: (id: string) =>
    getBackendClient().request<{ uplines: { id: string; name: string; depth: number }[]; nodes: NetworkNode[] }>(
      `/api/admin/affiliate/members/${encodeURIComponent(id)}/network`,
    ),
};
