const WP_FILE = /^\/foto\/wp\/([0-9]{4}\/[0-9]{2}\/[A-Za-z0-9._()+-]+\.(?:jpe?g|png|webp|gif))(?:\?[^#]*)?$/i;
export function productImageSources(values: (string | null | undefined)[]): string[] {
  const result: string[] = [];
  for (const raw of values) {
    const src = raw?.trim();
    if (!src) continue;
    // Only browser image schemes. Imported links cannot execute scripts.
    if (!/^https?:\/\//i.test(src) && !/^\/(?!\/)/.test(src) && !/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(src)) continue;
    result.push(src);
    const file = src.match(WP_FILE)?.[1];
    if (file) result.push(`https://gnnkracing.id/wp-content/uploads/${file}`);
  }
  return [...new Set(result)];
}
