export type NotificationChannel = 'email' | 'whatsapp';

export interface DigitalReceiptNotification {
  channel: NotificationChannel;
  to: string;
  subject?: string;
  message: string;
  storeName?: string;
  orderNumber?: string;
}

interface NotificationResponse {
  ok?: boolean;
  error?: string;
  channel?: NotificationChannel;
  result?: unknown;
}

export async function sendDigitalReceipt(
  payload: DigitalReceiptNotification,
): Promise<NotificationResponse> {
  const response = await fetch('/api/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await readResponse(response);

  if (!response.ok || body.error) {
    throw new Error(body.error || 'Gagal mengirim struk digital.');
  }

  return body;
}

async function readResponse(response: Response): Promise<NotificationResponse> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as NotificationResponse;
  } catch {
    return {
      error:
        response.status === 404
          ? 'Endpoint notifikasi belum aktif. Jalankan backend API di VPS.'
          : text,
    };
  }
}
