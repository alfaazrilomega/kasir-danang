import { expect, it } from 'vitest';
import { groupMailketingLists } from '@/lib/mailketingGroups';

it('mengelompokkan list dari awalan nama dan menaruh list tanpa grup di akhir', () => {
  expect(groupMailketingLists([
    { id: 3, name: 'User GNNKracing' },
    { id: 14, name: 'Reseller | Jakarta' },
    { id: 12, name: 'GNNK - Gear' },
    { id: 15, name: 'gnnk: Knalpot' },
  ])).toEqual([
    { name: 'GNNK', lists: [{ id: 12, name: 'GNNK - Gear', label: 'Gear' }, { id: 15, name: 'gnnk: Knalpot', label: 'Knalpot' }] },
    { name: 'Reseller', lists: [{ id: 14, name: 'Reseller | Jakarta', label: 'Jakarta' }] },
    { name: null, lists: [{ id: 3, name: 'User GNNKracing', label: 'User GNNKracing' }] },
  ]);
});

it('tanda hubung tanpa spasi tidak dianggap pemisah grup', () => {
  expect(groupMailketingLists([{ id: 1, name: 'Gear-Set Honda' }])).toEqual([
    { name: null, lists: [{ id: 1, name: 'Gear-Set Honda', label: 'Gear-Set Honda' }] },
  ]);
});
