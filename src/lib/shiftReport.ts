// Renders a thermal-style shift report (X-report when active, Z-report when
// closed) and prints it via a hidden iframe. Mirrors the receipt printing
// strategy already used in lib/receipt.ts.

import type { CashMovement, Order, Shift, Store } from '@/types';
import { formatDateTime, formatMoney } from '@/lib/format';
import { countsAsSale } from '@/lib/orderStatus';

export interface ShiftReportInput {
  store: Store;
  shift: Shift;
  movements: CashMovement[];
  /** Orders that belong to this shift (filtered by shift_id or by time window). */
  orders: Order[];
  cashierName?: string | null;
}

export interface PaymentBreakdown {
  cash: { count: number; total: number };
  qris: { count: number; total: number };
  ewallet: { count: number; total: number };
  card: { count: number; total: number };
  transfer: { count: number; total: number };
  /** Metode tidak diketahui, mis. penjualan hasil impor massal. */
  other: { count: number; total: number };
}

export function emptyBreakdown(): PaymentBreakdown {
  return {
    cash: { count: 0, total: 0 },
    qris: { count: 0, total: 0 },
    ewallet: { count: 0, total: 0 },
    card: { count: 0, total: 0 },
    transfer: { count: 0, total: 0 },
    other: { count: 0, total: 0 },
  };
}

export function computeBreakdown(orders: Order[]): PaymentBreakdown {
  const b = emptyBreakdown();
  for (const o of orders) {
    if (!countsAsSale(o)) continue;
    b[o.payment_method].count += 1;
    b[o.payment_method].total += Number(o.total);
  }
  return b;
}

export function buildShiftReportHTML(input: ShiftReportInput): string {
  const { store, shift, movements, orders, cashierName } = input;
  const money = (n: number) => formatMoney(n, store.currency);
  const isClosed = !!shift.closed_at;
  const reportKind = isClosed ? 'Z-REPORT (Tutup Shift)' : 'X-REPORT (Ringkasan Shift)';

  const breakdown = computeBreakdown(orders);
  const cashSales = breakdown.cash.total;
  let cashIn = 0, cashOut = 0;
  for (const m of movements) {
    if (m.type === 'in') cashIn += Number(m.amount);
    else if (m.type === 'out') cashOut += Number(m.amount);
  }
  const expected = Number(shift.opening_cash) + cashSales + cashIn - cashOut;
  const closing = shift.closing_cash != null ? Number(shift.closing_cash) : null;
  const diff = closing != null ? closing - expected : null;
  const totalSales = orders
    .filter(countsAsSale)
    .reduce((s, o) => s + Number(o.total), 0);
  const canceled = orders.filter((o) => o.order_status === 'canceled').length;

  function row(left: string, right: string, bold = false): string {
    return `<div class="row${bold ? ' total' : ''}"><span>${esc(left)}</span><span>${esc(right)}</span></div>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><title>Shift ${esc(shift.id.slice(0, 8))}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { font-family: 'DM Sans', ui-monospace, monospace; color: #000; font-size: 12px; margin: 0; padding: 0; }
  .wrap { width: 72mm; padding: 4mm 2mm; }
  h1 { font-size: 14px; margin: 0 0 2px; text-align: center; }
  .center { text-align: center; }
  .muted { color: #555; }
  .row { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
  .sep { border-top: 1px dashed #000; margin: 6px 0; }
  .total { font-weight: 700; font-size: 13px; }
  .section { margin-top: 4px; }
  .section-title { font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
</style>
</head><body>
<div class="wrap">
  <h1>${esc(store.name)}</h1>
  ${store.address ? `<div class="center muted">${esc(store.address)}</div>` : ''}
  <div class="center" style="font-weight:700;margin-top:4px;">${esc(reportKind)}</div>
  <div class="sep"></div>

  ${row('Kasir', cashierName ?? '—')}
  ${row('Buka', formatDateTime(shift.opened_at))}
  ${isClosed ? row('Tutup', formatDateTime(shift.closed_at!)) : ''}
  ${row('Cetak', formatDateTime(new Date().toISOString()))}

  <div class="section">
    <div class="section-title">Penjualan</div>
    ${row('Cash', `${breakdown.cash.count}×  ${money(breakdown.cash.total)}`)}
    ${row('QRIS', `${breakdown.qris.count}×  ${money(breakdown.qris.total)}`)}
    ${row('E-wallet', `${breakdown.ewallet.count}×  ${money(breakdown.ewallet.total)}`)}
    ${row('Transfer', `${breakdown.transfer.count}×  ${money(breakdown.transfer.total)}`)}
    ${breakdown.card.count > 0 ? row('Card', `${breakdown.card.count}×  ${money(breakdown.card.total)}`) : ''}
    ${row('Total order', String(orders.length - canceled))}
    ${canceled > 0 ? row('Dibatalkan', String(canceled)) : ''}
    ${row('Total penjualan', money(totalSales), true)}
  </div>

  <div class="section">
    <div class="section-title">Kas</div>
    ${row('Saldo awal', money(Number(shift.opening_cash)))}
    ${row('+ Penjualan cash', money(cashSales))}
    ${cashIn > 0 ? row('+ Kas masuk', money(cashIn)) : ''}
    ${cashOut > 0 ? row('- Kas keluar', `-${money(cashOut)}`) : ''}
    ${row('Estimasi saldo', money(expected), true)}
    ${closing != null ? row('Saldo fisik', money(closing)) : ''}
    ${diff != null
      ? `<div class="row total" style="${diff === 0 ? '' : diff > 0 ? 'color:#047857' : 'color:#be123c'}">
          <span>Selisih</span><span>${diff > 0 ? '+' : ''}${money(diff)}</span>
        </div>`
      : ''}
  </div>

  ${movements.filter((m) => m.type === 'in' || m.type === 'out').length > 0 ? `
  <div class="section">
    <div class="section-title">Pergerakan Kas</div>
    ${movements
      .filter((m) => m.type === 'in' || m.type === 'out')
      .map((m) =>
        `<div class="row"><span>${esc(formatDateTime(m.created_at))} · ${m.type === 'in' ? 'In' : 'Out'}</span><span>${m.type === 'in' ? '+' : '-'}${money(Number(m.amount))}</span></div>`
        + (m.note ? `<div class="muted" style="font-size:11px;padding-left:8px;">↳ ${esc(m.note)}</div>` : ''),
      )
      .join('')}
  </div>` : ''}

  ${shift.notes ? `
  <div class="section">
    <div class="section-title">Catatan</div>
    <div>${esc(shift.notes)}</div>
  </div>` : ''}

  <div class="sep"></div>
  <div class="center muted">— Akhir ${isClosed ? 'Z' : 'X'}-Report —</div>
</div>
<script>window.addEventListener('load', () => { window.print(); });</script>
</body></html>`;
}

export function printShiftReport(input: ShiftReportInput) {
  const html = buildShiftReportHTML(input);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const idoc = iframe.contentDocument!;
  idoc.open();
  idoc.write(html);
  idoc.close();
  iframe.contentWindow?.addEventListener('afterprint', () => {
    setTimeout(() => document.body.removeChild(iframe), 500);
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
