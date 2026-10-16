// Client-side image processing: resize + JPEG-encode an uploaded File into a
// data URL. We store the result directly in products.image_url, so this works
// offline and without configuring an object storage bucket.

const DEFAULT_MAX_DIM = 900; // px on the longest edge
const DEFAULT_QUALITY = 0.85;
const MAX_INPUT_BYTES = 8 * 1024 * 1024; // 8 MB raw input limit

export interface ProcessedImage {
  dataUrl: string;
  width: number;
  height: number;
  /** Approximate byte size of the encoded result. */
  bytes: number;
}

export async function resizeImageToDataUrl(
  file: File,
  opts: { maxDim?: number; quality?: number } = {},
): Promise<ProcessedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('File yang dipilih bukan gambar.');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('Ukuran file terlalu besar (maks 8 MB).');
  }
  const maxDim = opts.maxDim ?? DEFAULT_MAX_DIM;
  const quality = opts.quality ?? DEFAULT_QUALITY;

  const bitmap = await loadBitmap(file);
  try {
    const { width, height } = fitTo(bitmap.width, bitmap.height, maxDim);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas tidak tersedia.');
    ctx.drawImage(bitmap, 0, 0, width, height);
    // Pick output format: PNG with transparency only if input is PNG/webp with
    // alpha; otherwise JPEG which is far smaller for photos.
    const mime = /png|webp/i.test(file.type) ? 'image/png' : 'image/jpeg';
    const dataUrl = canvas.toDataURL(mime, quality);
    return {
      dataUrl,
      width,
      height,
      bytes: approxDataUrlBytes(dataUrl),
    };
  } finally {
    if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

function fitTo(w: number, h: number, maxDim: number): { width: number; height: number } {
  if (w <= maxDim && h <= maxDim) return { width: w, height: h };
  const ratio = w / h;
  if (w >= h) return { width: maxDim, height: Math.round(maxDim / ratio) };
  return { width: Math.round(maxDim * ratio), height: maxDim };
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to <img> fallback (Safari etc) */
    }
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Gagal membaca gambar.'));
    };
    img.src = url;
  });
}

function approxDataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(',');
  if (i < 0) return dataUrl.length;
  const b64 = dataUrl.slice(i + 1);
  // base64 → bytes: ~ length * 3/4, minus padding
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
