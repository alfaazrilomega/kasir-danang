// Accent color themes. The Tailwind `brand-*` palette is driven by CSS
// variables (see index.css + tailwind.config.js), so switching accent just
// rewrites those variables at runtime — no rebuild, no class changes.

export interface Accent {
  id: string;
  label: string;
  /** Preview color for the picker — the 600 shade, as hex. */
  swatch: string;
  /** RGB triplets per Tailwind shade, applied as `--brand-<shade>`. */
  shades: Record<number, string>;
}

export const ACCENTS: Accent[] = [
  {
    id: 'violet',
    label: 'Ungu',
    swatch: '#5a41e5',
    shades: {
      50: '243 241 255', 100: '235 229 255', 200: '217 206 255',
      300: '189 167 255', 400: '155 117 255', 500: '124 77 255',
      600: '90 65 229', 700: '74 50 197', 800: '61 42 160',
      900: '51 38 130', 950: '31 21 81',
    },
  },
  {
    id: 'blue',
    label: 'Biru',
    swatch: '#2563eb',
    shades: {
      50: '239 246 255', 100: '219 234 254', 200: '191 219 254',
      300: '147 197 253', 400: '96 165 250', 500: '59 130 246',
      600: '37 99 235', 700: '29 78 216', 800: '30 64 175',
      900: '30 58 138', 950: '23 37 84',
    },
  },
  {
    id: 'emerald',
    label: 'Hijau',
    swatch: '#059669',
    shades: {
      50: '236 253 245', 100: '209 250 229', 200: '167 243 208',
      300: '110 231 183', 400: '52 211 153', 500: '16 185 129',
      600: '5 150 105', 700: '4 120 87', 800: '6 95 70',
      900: '6 78 59', 950: '2 44 34',
    },
  },
  {
    id: 'teal',
    label: 'Teal',
    swatch: '#0d9488',
    shades: {
      50: '240 253 250', 100: '204 251 241', 200: '153 246 228',
      300: '94 234 212', 400: '45 212 191', 500: '20 184 166',
      600: '13 148 136', 700: '15 118 110', 800: '17 94 89',
      900: '19 78 74', 950: '4 47 46',
    },
  },
  {
    id: 'amber',
    label: 'Oranye',
    swatch: '#d97706',
    shades: {
      50: '255 251 235', 100: '254 243 199', 200: '253 230 138',
      300: '252 211 77', 400: '251 191 36', 500: '245 158 11',
      600: '217 119 6', 700: '180 83 9', 800: '146 64 14',
      900: '120 53 15', 950: '69 26 3',
    },
  },
  {
    id: 'rose',
    label: 'Merah',
    swatch: '#e11d48',
    shades: {
      50: '255 241 242', 100: '255 228 230', 200: '254 205 211',
      300: '253 164 175', 400: '251 113 133', 500: '244 63 94',
      600: '225 29 72', 700: '190 18 60', 800: '159 18 57',
      900: '136 19 55', 950: '76 5 25',
    },
  },
];

export const DEFAULT_ACCENT = ACCENTS[0].id;

/** Rewrites the `--brand-*` CSS variables to the chosen accent. */
export function applyAccent(id: string) {
  const accent = ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
  const root = document.documentElement;
  for (const [shade, rgb] of Object.entries(accent.shades)) {
    root.style.setProperty(`--brand-${shade}`, rgb);
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', accent.swatch);
}
