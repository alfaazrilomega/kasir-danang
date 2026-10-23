import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { readProductDrafts, saveProductDraft, removeProductDraft } from '../productDrafts';
const defaults = { name: '', sku: '', stock_qty: 0, images: [] as string[], newVariants: [] as { sku: string }[], mailketing_order_list_id: null as number | null };
let entries: Map<string,string>;
beforeEach(() => {
  entries = new Map();
  vi.stubGlobal('localStorage', { get length() { return entries.size; }, key: (i: number) => [...entries.keys()][i], getItem: (k: string) => entries.get(k) ?? null, setItem: (k: string,v: string) => entries.set(k,v), removeItem: (k: string) => entries.delete(k) });
});
afterEach(() => vi.unstubAllGlobals());
it('restores independent drafts and preserves variants, photo and product settings', () => {
  saveProductDraft('shop-a','draft-a',{...defaults,name:'Gear (Salinan)',sku:'NEW',images:['https://shop.test/photo.jpg'],newVariants:[{sku:'V1'}],mailketing_order_list_id:8});
  saveProductDraft('shop-a','draft-b',{...defaults,name:'Second'});
  const rows=readProductDrafts('shop-a',defaults); expect(rows).toHaveLength(2);
  expect(rows.find(d=>d.id==='draft-a')?.form).toMatchObject({name:'Gear (Salinan)',sku:'NEW',newVariants:[{sku:'V1'}],mailketing_order_list_id:8});
  expect(readProductDrafts('shop-b',defaults)).toEqual([]);
  removeProductDraft('shop-a','draft-a'); expect(readProductDrafts('shop-a',defaults).map(d=>d.id)).toEqual(['draft-b']);
});
it('ignores malformed drafts, rejects existing products, and upgrades optional fields', () => {
  expect(()=>saveProductDraft('shop','id',{...defaults,id:'existing'})).toThrow();
  localStorage.setItem('kasir:product-draft:v1:shop:broken','{');
  localStorage.setItem('kasir:product-draft:v1:shop:wrong',JSON.stringify({version:1,id:'wrong',updatedAt:new Date().toISOString(),form:{name:'Bad',images:'wrong'}}));
  saveProductDraft('shop','old',{name:'Old'});
  expect(readProductDrafts('shop',defaults)).toHaveLength(1);
  expect(readProductDrafts('shop',defaults)[0].form).toMatchObject({name:'Old',newVariants:[],images:[]});
});
it('storage quota errors leave the previous saved draft intact', () => {
  saveProductDraft('shop','id',{...defaults,name:'Saved'});
  localStorage.setItem=()=>{throw new Error('quota')};
  expect(()=>saveProductDraft('shop','id',{...defaults,name:'New'})).toThrow('quota');
  expect(readProductDrafts('shop',defaults)[0].form.name).toBe('Saved');
});
