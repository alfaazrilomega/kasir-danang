export interface ProductDraft<T> { version: 1; id: string; updatedAt: string; form: T }
const prefix = (storeId: string) => `kasir:product-draft:v1:${storeId}:`;

export function readProductDrafts<T extends { id?: string; name: string }>(storeId: string, defaults: T): ProductDraft<T>[] {
  if (!storeId) return [];
  const result: ProductDraft<T>[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix(storeId))) continue;
    try {
      const draft = JSON.parse(localStorage.getItem(key) || 'null');
      if (draft?.version !== 1 || typeof draft.id !== 'string' || key !== prefix(storeId) + draft.id || !Number.isFinite(Date.parse(draft.updatedAt))) continue;
      const data = draft.form;
      if (!data || data.id || typeof data.name !== 'string') continue;
      // Older drafts inherit newly added optional fields. Invalid types are never opened in the editor.
      const valid = Object.entries(defaults).every(([name, value]) => !(name in data) || value === null || (Array.isArray(value) ? Array.isArray(data[name]) : typeof data[name] === typeof value));
      if (!valid) continue;
      result.push({ ...draft, form: { ...defaults, ...data, id: undefined } });
    } catch { /* Ignore malformed records; do not delete other drafts. */ }
  }
  return result.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveProductDraft<T extends { id?: string; name: string }>(storeId: string, id: string, form: T) {
  if (!storeId || !id || form.id) throw new Error('Hanya produk baru yang dapat dicadangkan.');
  const draft: ProductDraft<T> = { version: 1, id, updatedAt: new Date().toISOString(), form };
  localStorage.setItem(prefix(storeId) + id, JSON.stringify(draft));
  return draft;
}
export function removeProductDraft(storeId: string, id: string) { localStorage.removeItem(prefix(storeId) + id); }
