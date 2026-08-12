// Cash drawer denomination helper.
// Provides the IDR (and a few other currencies) denominations and a small
// counter type used by the open/close shift modals to verify the physical cash
// count against the system's expected balance.

export interface DenomDef {
  value: number;
  label: string;
}

export type Counts = Record<number, number>;

const IDR_DENOMS: DenomDef[] = [
  { value: 100000, label: 'Rp 100.000' },
  { value: 50000, label: 'Rp 50.000' },
  { value: 20000, label: 'Rp 20.000' },
  { value: 10000, label: 'Rp 10.000' },
  { value: 5000, label: 'Rp 5.000' },
  { value: 2000, label: 'Rp 2.000' },
  { value: 1000, label: 'Rp 1.000' },
  { value: 500, label: 'Rp 500' },
  { value: 200, label: 'Rp 200' },
  { value: 100, label: 'Rp 100' },
];

const USD_DENOMS: DenomDef[] = [
  { value: 100, label: '$100' },
  { value: 50, label: '$50' },
  { value: 20, label: '$20' },
  { value: 10, label: '$10' },
  { value: 5, label: '$5' },
  { value: 1, label: '$1' },
  { value: 0.25, label: '25¢' },
  { value: 0.1, label: '10¢' },
  { value: 0.05, label: '5¢' },
  { value: 0.01, label: '1¢' },
];

export function denomsFor(currency: string | undefined): DenomDef[] {
  switch ((currency ?? 'IDR').toUpperCase()) {
    case 'USD':
      return USD_DENOMS;
    case 'IDR':
    case 'MYR':
    case 'SGD':
    default:
      return IDR_DENOMS;
  }
}

export function totalOf(counts: Counts, denoms: DenomDef[]): number {
  return denoms.reduce((sum, d) => sum + (counts[d.value] ?? 0) * d.value, 0);
}
