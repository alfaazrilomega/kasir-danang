// Impor dan ekspor massal pelanggan.
//
// Client punya database pembeli lama dari penjualan WhatsApp bertahun-tahun,
// dan mengetiknya satu per satu ke formulir Tambah Pelanggan memakan waktu
// lama untuk ratusan baris. Kolom impor dibuat sama persis dengan hasil
// ekspornya, jadi client bisa mengunduh contohnya sekali untuk melihat
// bentuknya, isi dari database lama mereka, lalu unggah balik.
//
// Pencocokan lewat nomor HP, bukan nama: nama bisa kembar, nomor HP adalah
// identitas nyata yang dipakai WhatsApp itu sendiri. Pelanggan tanpa nomor HP
// selalu dianggap baru karena tidak ada kunci yang bisa dipakai mencocokkan.

import { db } from './db';
import { getBackendClient } from './api';
import { readSpreadsheet } from './spreadsheet';
import { buildCsv, csvFilename, date as fmtDate, downloadCsv, text, yesNo } from './csvFormat';
import { uuid } from './format';
import type { Customer } from '@/types';

export const CUSTOMER_COLUMNS = ['Nama', 'Phone', 'Email', 'Lokasi', 'Aktif'] as const;

function normalizePhone(v: string): string {
  return String(v ?? '').replace(/[^0-9+]/g, '');
}

function parseBoolean(value: string, fallback: boolean): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return fallback;
  return ['ya', 'yes', 'true', '1', 'aktif', 'active'].includes(v);
}

export interface CustomerImportRow {
  row: number;
  name: string;
  phone: string | null;
  email: string | null;
  location: string | null;
  isActive: boolean;
  /** Terisi kalau nomor HP-nya cocok dengan pelanggan yang sudah ada. */
  existingId: string | null;
}

export interface CustomerImportIssue {
  row: number;
  message: string;
}

export interface CustomerImportPlan {
  rows: CustomerImportRow[];
  issues: CustomerImportIssue[];
  toCreate: number;
  toUpdate: number;
  totalRows: number;
}

export function planCustomerImport(fileRows: string[][], existing: Customer[]): CustomerImportPlan {
  const issues: CustomerImportIssue[] = [];
  if (fileRows.length < 2) {
    return { rows: [], issues: [{ row: 0, message: 'Berkas kosong.' }], toCreate: 0, toUpdate: 0, totalRows: 0 };
  }

  const header = fileRows[0].map((h) => h.trim());
  const idxNama = header.findIndex((h) => h.toLowerCase() === 'nama');
  if (idxNama < 0) {
    return {
      rows: [],
      issues: [{ row: 1, message: 'Kolom "Nama" wajib ada.' }],
      toCreate: 0,
      toUpdate: 0,
      totalRows: 0,
    };
  }
  const idxPhone = header.findIndex((h) => h.toLowerCase() === 'phone');
  const idxEmail = header.findIndex((h) => h.toLowerCase() === 'email');
  const idxLokasi = header.findIndex((h) => h.toLowerCase() === 'lokasi');
  const idxAktif = header.findIndex((h) => h.toLowerCase() === 'aktif');

  const byPhone = new Map(
    existing.filter((c) => c.phone).map((c) => [normalizePhone(c.phone!), c]),
  );

  const rows: CustomerImportRow[] = [];
  let toCreate = 0;
  let toUpdate = 0;
  let totalRows = 0;
  // Dalam satu berkas pun dua baris bisa punya nomor sama (data ganda di
  // database lama); baris berikutnya diarahkan ke pelanggan yang sama supaya
  // tidak membuat dua baris baru berebut satu nomor.
  const seenInFile = new Map<string, string>();

  for (let i = 1; i < fileRows.length; i++) {
    const line = fileRows[i];
    if (!line.some((c) => String(c ?? '').trim())) continue;
    const nomorBaris = i + 1;
    totalRows++;

    const name = String(line[idxNama] ?? '').trim();
    if (!name) {
      issues.push({ row: nomorBaris, message: 'Nama kosong, baris dilewati.' });
      continue;
    }

    const phoneRaw = idxPhone >= 0 ? String(line[idxPhone] ?? '').trim() : '';
    const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
    const email = idxEmail >= 0 ? String(line[idxEmail] ?? '').trim() || null : null;
    const location = idxLokasi >= 0 ? String(line[idxLokasi] ?? '').trim() || null : null;
    const isActive = idxAktif >= 0 ? parseBoolean(String(line[idxAktif] ?? ''), true) : true;

    const existingId = phone ? (byPhone.get(phone)?.id ?? seenInFile.get(phone) ?? null) : null;
    if (phone) seenInFile.set(phone, existingId ?? '');

    if (existingId) toUpdate++;
    else toCreate++;

    rows.push({ row: nomorBaris, name, phone, email, location, isActive, existingId });
  }

  return { rows, issues, toCreate, toUpdate, totalRows };
}

export async function planCustomerImportFromFile(
  file: File,
  existing: Customer[],
): Promise<CustomerImportPlan> {
  const fileRows = await readSpreadsheet(file);
  return planCustomerImport(fileRows, existing);
}

export interface CustomerImportResult {
  created: number;
  updated: number;
  serverErrors: string[];
}

export async function runCustomerImport(
  plan: CustomerImportPlan,
  storeId: string,
  existing: Customer[],
): Promise<CustomerImportResult> {
  const api = getBackendClient();
  const online = navigator.onLine;
  const existingById = new Map(existing.map((c) => [c.id, c]));
  const serverErrors: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  const toWrite: Customer[] = [];
  for (const r of plan.rows) {
    const prev = r.existingId ? existingById.get(r.existingId) : null;
    toWrite.push({
      id: r.existingId ?? uuid(),
      store_id: storeId,
      name: r.name,
      phone: r.phone,
      email: r.email,
      location: r.location,
      joined_date: prev?.joined_date ?? today,
      is_active: r.isActive,
      points: prev?.points ?? 0,
    });
  }

  if (online && toWrite.length) {
    const CHUNK = 200;
    for (let i = 0; i < toWrite.length; i += CHUNK) {
      const { error } = await api.from('customers').upsert(toWrite.slice(i, i + CHUNK));
      if (error) {
        serverErrors.push(error.message);
        return { created: 0, updated: 0, serverErrors };
      }
    }
  }

  await db.customers.bulkPut(toWrite);
  return { created: plan.toCreate, updated: plan.toUpdate, serverErrors };
}

/** Berkas contoh: judul kolom dan dua baris isian. */
export function buildCustomerTemplateRows(): string[][] {
  return [
    [...CUSTOMER_COLUMNS],
    ['Budi Santoso', '081234567890', 'budi@contoh.com', 'Jakarta Selatan', 'ya'],
    ['Siti Rahma', '081298765432', '', 'Bandung', 'ya'],
  ];
}

export function buildCustomerTemplate(): string {
  const baris = buildCustomerTemplateRows().map((r) => r.join(';'));
  return `sep=;\r\n${baris.join('\r\n')}\r\n`;
}

/** Ekspor pelanggan yang sedang tampil di layar (hasil filter/pencarian). */
export function exportCustomersCsv(customers: Customer[]): number {
  const rows = customers
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => [
      text(c.name),
      text(c.phone),
      text(c.email),
      text(c.location),
      yesNo(c.is_active),
      fmtDate(c.joined_date),
      c.points,
    ]);
  downloadCsv(
    csvFilename('customers'),
    buildCsv([...CUSTOMER_COLUMNS, 'Bergabung', 'Poin'], rows),
  );
  return rows.length;
}
