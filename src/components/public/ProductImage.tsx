import { useState, type ImgHTMLAttributes } from 'react';
import { ShoppingBag } from 'lucide-react';
import { productImageSources } from '@/lib/productImages';

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & { src?: string | null; alternatives?: (string | null | undefined)[] };

/** Each URL is attempted once. A failed proxy falls back to the original WordPress image. */
export function ProductImage({ src, alternatives = [], ...props }: Props) {
  const sources = productImageSources([src, ...alternatives]);
  return <ImageAttempt key={JSON.stringify(sources)} sources={sources} {...props} />;
}
function ImageAttempt({ sources, alt = '', className, ...props }: Omit<Props, 'src' | 'alternatives'> & { sources: string[] }) {
  const [index, setIndex] = useState(0);
  if (index >= sources.length) return <span role="img" aria-label={alt ? `Foto ${alt} belum tersedia` : 'Foto belum tersedia'} className={`flex items-center justify-center bg-ink-50 text-ink-300 dark:bg-ink-900 dark:text-ink-600 ${className || ''}`}><ShoppingBag size={30} aria-hidden="true" /></span>;
  return <img {...props} src={sources[index]} alt={alt} className={className} referrerPolicy="no-referrer" onError={() => setIndex(current => current + 1)} />;
}
