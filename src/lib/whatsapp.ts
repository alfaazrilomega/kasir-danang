import { getBackendClient } from './api';
export type WATemplateKey = 'order_new' | 'wa1' | 'wa2' | 'wa3';
export type WAProvider = 'onesender' | 'meta_whatsapp';
export interface WATemplate { text: string; metaName: string; metaLanguage: string; metaParameters: string[] }
export interface WASettings { enabled: boolean; provider: WAProvider; templates: Record<WATemplateKey, WATemplate>; reminders: { enabled: boolean; minutes: number[] } }
export interface WAReminder {
  id: string; order_id: string; order_number: string; template_key: WATemplateKey; scheduled_at: string;
  status: 'pending' | 'processing' | 'sent' | 'skipped' | 'failed'; reason: string | null; message_id: string | null;
}
export const REMINDER_STATUS: Record<WAReminder['status'], string> = { pending: 'Terjadwal', processing: 'Diproses', sent: 'Diterima API', skipped: 'Dilewati', failed: 'Perlu diperiksa' };
export interface WAMessage {
  id: string; customer_id: string | null; order_id: string | null; template_key: WATemplateKey; provider: WAProvider;
  recipient: string; message_text: string; status: 'draft' | 'sending' | 'accepted' | 'failed' | 'unknown';
  provider_message_id?: string | null; error_message?: string | null; created_at: string;
}
export interface WAOrder { id: string; order_number: string; total: number; payment_status: string }
export const WA_LABELS: Record<WATemplateKey, string> = { order_new: 'Rincian Order', wa1: 'WA 1', wa2: 'WA 2', wa3: 'WA 3' };
export const WA_STATUS = { draft: 'Pratinjau', sending: 'Sedang diproses / perlu diperiksa', accepted: 'Diterima API', failed: 'Gagal', unknown: 'Belum dapat dipastikan' };
export async function waRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const { data, error } = await getBackendClient().request<T>(path, { method, body });
  if (error || data === null) throw new Error(error?.message || 'Permintaan WhatsApp gagal.');
  return data;
}
export const waApi = {
  settings: () => waRequest<{ settings: WASettings; variables: string[] }>('/api/admin/whatsapp/settings'),
  save: (settings: WASettings) => waRequest<WASettings>('/api/admin/whatsapp/settings', 'PUT', settings),
  history: () => waRequest<WAMessage[]>('/api/admin/whatsapp/messages'),
  reminders: () => waRequest<WAReminder[]>('/api/admin/whatsapp/reminders'),
  orders: (customerId: string) => waRequest<WAOrder[]>(`/api/admin/customers/${encodeURIComponent(customerId)}/whatsapp/orders`),
  preview: (customerId: string, templateKey: WATemplateKey, orderId?: string) => waRequest<WAMessage>(`/api/admin/customers/${encodeURIComponent(customerId)}/whatsapp/preview`, 'POST', { templateKey, orderId }),
  send: (id: string) => waRequest<WAMessage>(`/api/admin/whatsapp/messages/${encodeURIComponent(id)}/send`, 'POST'),
};
