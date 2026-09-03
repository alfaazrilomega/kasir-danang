// Pembaca berkas tabel: CSV dan XLSX jadi satu bentuk baris-kolom.
//
// Client mengunggah berkas mentah hasil ekspor Shopee dan TikTok, dan keduanya
// berbentuk .xlsx. Meminta mereka menyimpan ulang jadi CSV tiap kali hanya
// menambah satu langkah manual yang gampang salah (pemisah koma vs titik koma
// di Excel Indonesia).
//
// .xlsx sebenarnya zip berisi XML. Yang dibutuhkan cuma "baca sel jadi teks",
// jadi cukup fflate untuk membuka zip-nya dan DOMParser bawaan browser untuk
// membaca XML-nya. Paket SheetJS di registry npm sengaja tidak dipakai: versi
// yang ada di sana membawa CVE yang belum ditambal lewat jalur itu, dan itu
// harga yang terlalu mahal untuk pekerjaan sesederhana ini.

import { parseCsv } from './dataTransfer';

/** Ubah "BC" jadi 54 (nomor kolom, mulai dari 0). */
function columnIndex(ref: string): number {
  const huruf = /^[A-Z]+/.exec(ref)?.[0] ?? '';
  let n = 0;
  for (const c of huruf) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function textOf(node: Element | null): string {
  if (!node) return '';
  // <si> boleh terpecah jadi beberapa <t> kalau sebagian katanya diberi format
  // berbeda. Semuanya digabung supaya isinya utuh.
  return Array.from(node.getElementsByTagName('t'))
    .map((t) => t.textContent ?? '')
    .join('');
}

/**
 * Baca lembar PERTAMA sebuah .xlsx.
 *
 * Lembar pertama dipilih karena ekspor Shopee membawa lembar kedua
 * ("Advance Fulfilment") yang bukan daftar pesanan.
 */
async function readXlsx(file: File): Promise<string[][]> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const parser = new DOMParser();

  const shared: string[] = [];
  const sharedRaw = zip['xl/sharedStrings.xml'];
  if (sharedRaw) {
    const doc = parser.parseFromString(strFromU8(sharedRaw), 'application/xml');
    for (const si of Array.from(doc.getElementsByTagName('si'))) shared.push(textOf(si));
  }

  const sheetPath = Object.keys(zip)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()[0];
  if (!sheetPath) throw new Error('Berkas xlsx tidak berisi lembar kerja.');

  const doc = parser.parseFromString(strFromU8(zip[sheetPath]), 'application/xml');
  const rows: string[][] = [];
  for (const row of Array.from(doc.getElementsByTagName('row'))) {
    const cells: string[] = [];
    for (const c of Array.from(row.getElementsByTagName('c'))) {
      const at = columnIndex(c.getAttribute('r') ?? '');
      let value = '';
      if (c.getAttribute('t') === 's') {
        const v = c.getElementsByTagName('v')[0];
        const i = Number(v?.textContent ?? -1);
        value = shared[i] ?? '';
      } else if (c.getAttribute('t') === 'inlineStr') {
        value = textOf(c.getElementsByTagName('is')[0] ?? null);
      } else {
        value = c.getElementsByTagName('v')[0]?.textContent ?? '';
      }
      // Sel kosong tidak ditulis sama sekali di xlsx, jadi posisinya diisi
      // sendiri supaya nomor kolomnya tetap cocok dengan judulnya.
      if (at >= 0) {
        while (cells.length < at) cells.push('');
        cells[at] = value;
      } else {
        cells.push(value);
      }
    }
    rows.push(cells);
  }
  return rows;
}

/** Ubah 0 jadi "A", 26 jadi "AA". */
function columnName(index: number): string {
  let s = '';
  let n = index + 1;
  while (n > 0) {
    const sisa = (n - 1) % 26;
    s = String.fromCharCode(65 + sisa) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Tulis .xlsx sederhana dari baris-kolom teks.
 *
 * Dipakai untuk template unduhan. Semua sel ditulis sebagai teks sebaris
 * (inlineStr) supaya tidak perlu tabel string bersama — berkasnya tetap sah dan
 * bisa dibuka Excel maupun dibaca balik oleh readSpreadsheet di atas.
 */
export async function buildXlsx(rows: string[][]): Promise<Blob> {
  const { zipSync, strToU8 } = await import('fflate');

  const rowsXml = rows
    .map((cols, r) => {
      const cells = cols
        .map((v, c) =>
          v === ''
            ? ''
            : `<c r="${columnName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`,
        )
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="penjualan" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '</Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        `<sheetData>${rowsXml}</sheetData></worksheet>`,
    ),
  };

  return new Blob([zipSync(files) as unknown as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Simpan Blob sebagai berkas unduhan. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Kenali .xlsx dari namanya maupun dari tipe MIME-nya. */
export function isSpreadsheetFile(file: File): boolean {
  return (
    /\.xlsx$/i.test(file.name) ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
}

/**
 * Baca berkas apa pun (CSV atau XLSX) menjadi baris-kolom teks.
 *
 * Pemanggilnya tidak perlu tahu asal berkasnya — itu yang membuat satu jalur
 * impor bisa melayani berkas buatan sendiri maupun ekspor marketplace.
 */
export async function readSpreadsheet(file: File): Promise<string[][]> {
  if (isSpreadsheetFile(file)) return readXlsx(file);
  return parseCsv(await file.text());
}
