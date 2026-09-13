// Cetak label barcode untuk ditempel di produk.
//
// Kode yang dicetak adalah barcode produk kalau ada, kalau tidak SKU-nya.
// Scanner di kasir mencocokkan keduanya, jadi label dari sini langsung bisa
// dipindai di POS. Formatnya CODE128 karena bisa memuat semua karakter SKU
// client (huruf, angka, "-", "/", "+"), tidak seperti EAN yang hanya angka.

import JsBarcode from 'jsbarcode';
import { formatMoney } from '@/lib/format';

export type UkuranLabel = '50x30' | '38x25' | 'a4';

export const UKURAN_LABEL: { value: UkuranLabel; label: string; hint: string }[] = [
  { value: '50x30', label: 'Label 50 × 30 mm', hint: 'Printer label/thermal, satu label per lembar.' },
  { value: '38x25', label: 'Label 38 × 25 mm', hint: 'Label kecil untuk barang kecil.' },
  { value: 'a4', label: 'Stiker A4 (3 × 8)', hint: 'Kertas stiker A4 isi 24 label.' },
];

export interface LabelItem {
  name: string;
  code: string;
  price: number | null;
  copies: number;
}

export function kodeLabel(p: { barcode?: string | null; sku?: string | null }): string {
  return (p.barcode || p.sku || '').trim();
}

/** Markup SVG barcode CODE128, atau null bila kodenya tidak bisa dijadikan barcode. */
export function svgBarcode(code: string): string | null {
  if (!code) return null;
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, code, {
      format: 'CODE128',
      width: 2,
      height: 50,
      displayValue: true,
      fontSize: 16,
      textMargin: 2,
      margin: 0,
    });
    // Ukuran asli diganti viewBox supaya barcode mengecil proporsional
    // mengikuti kotak label, tanpa mengubah perbandingan lebar batang.
    const w = parseFloat(svg.getAttribute('width') ?? '0');
    const h = parseFloat(svg.getAttribute('height') ?? '0');
    if (w && h) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.removeAttribute('style');
    return svg.outerHTML;
  } catch {
    return null;
  }
}

const GAYA: Record<UkuranLabel, { page: string; label: string; nama: string; bar: string; harga: string }> = {
  '50x30': {
    page: '@page { size: 50mm 30mm; margin: 0; }',
    label: 'width:50mm;height:30mm;padding:1.5mm 2mm;page-break-after:always;',
    nama: 'font-size:7.5pt;',
    bar: 'height:15mm;',
    harga: 'font-size:8pt;',
  },
  '38x25': {
    page: '@page { size: 38mm 25mm; margin: 0; }',
    label: 'width:38mm;height:25mm;padding:1mm 1.5mm;page-break-after:always;',
    nama: 'font-size:6.5pt;',
    bar: 'height:12mm;',
    harga: 'font-size:7pt;',
  },
  a4: {
    page: '@page { size: A4; margin: 10mm 7mm; }',
    label: 'width:64mm;height:33.9mm;padding:2mm 3mm;break-inside:avoid;',
    nama: 'font-size:8pt;',
    bar: 'height:16mm;',
    harga: 'font-size:9pt;',
  },
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildLabelHtml(items: LabelItem[], ukuran: UkuranLabel, currency?: string): string {
  const g = GAYA[ukuran];
  const labels: string[] = [];
  for (const it of items) {
    const svg = svgBarcode(it.code);
    if (!svg) continue;
    const satu = `<div class="label">
  <div class="nama">${esc(it.name)}</div>
  <div class="bar">${svg}</div>
  ${it.price != null ? `<div class="harga">${esc(formatMoney(it.price, currency))}</div>` : ''}
</div>`;
    for (let i = 0; i < Math.max(1, it.copies); i++) labels.push(satu);
  }
  const wadah =
    ukuran === 'a4'
      ? `<div style="display:grid;grid-template-columns:repeat(3,64mm);grid-auto-rows:33.9mm;">${labels.join('')}</div>`
      : labels.join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Label Barcode</title>
<style>
  ${g.page}
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
  .label { ${g.label} display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; }
  .nama { ${g.nama} font-weight: 700; line-height: 1.15; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .bar { ${g.bar} display: flex; align-items: center; justify-content: center; }
  .bar svg { width: 100%; height: 100%; }
  .harga { ${g.harga} font-weight: 700; text-align: right; }
</style></head><body>${wadah}
<script>window.addEventListener('load', () => { window.print(); });</script>
</body></html>`;
}

/** Cetak lewat iframe tersembunyi, sama seperti struk. */
export function printLabels(items: LabelItem[], ukuran: UkuranLabel, currency?: string) {
  const html = buildLabelHtml(items, ukuran, currency);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.title = 'Label Barcode';
  document.body.appendChild(iframe);
  const idoc = iframe.contentDocument!;
  idoc.open();
  idoc.write(html);
  idoc.close();
  iframe.contentWindow?.addEventListener('afterprint', () => {
    setTimeout(() => iframe.remove(), 500);
  });
}
