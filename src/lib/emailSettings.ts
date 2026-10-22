import { getBackendClient } from './api';
export type EmailTemplateKey = 'order_customer' | 'order_admin' | 'password_reset';
export interface EmailConfig {
  provider: 'server' | 'mailketing' | 'smtp'; fromName: string; fromEmail: string;
  apiToken?: string; hasApiToken: boolean; smtpHost: string; smtpPort: number;
  smtpUser: string; smtpPassword?: string; hasSmtpPassword: boolean; orderNotifyEmail: string | null;
}
export interface EmailTemplate { subject: string; html: string }
export interface EmailSettings { config: EmailConfig; templates: Record<EmailTemplateKey, EmailTemplate> }
export interface EmailPreview { subject: string; html: string; text: string }
export const EMAIL_LABELS: Record<EmailTemplateKey, string> = { order_customer: 'Order ke customer', order_admin: 'Order ke admin', password_reset: 'Reset kata sandi' };
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const result = await getBackendClient().request<T>(path, { method, body });
  if (result.error || !result.data) throw new Error(result.error?.message || 'Permintaan email gagal.');
  return result.data;
}
export const emailApi = {
  load: () => request<EmailSettings & { variables: Record<EmailTemplateKey, string[]> }>('/api/admin/email/settings'),
  save: (settings: EmailSettings) => request<EmailSettings>('/api/admin/email/settings', 'PUT', settings),
  test: () => request<{ message: string }>('/api/admin/email/test', 'POST'),
  preview: (key: EmailTemplateKey, templates: EmailSettings['templates']) => request<EmailPreview>('/api/admin/email/preview', 'POST', { key, templates }),
};
