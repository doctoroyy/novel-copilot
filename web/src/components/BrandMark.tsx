import brandMarkUrl from '@/assets/brand-mark.png';
import { cn } from '@/lib/utils';

interface BrandMarkProps {
  className?: string;
  imageClassName?: string;
  alt?: string;
  decorative?: boolean;
}

export function BrandMark({
  className,
  imageClassName,
  alt = 'Novel Copilot',
  decorative = false,
}: BrandMarkProps) {
  return (
    <div className={cn('shrink-0 overflow-hidden rounded-[22%]', className)}>
      <img
        src={brandMarkUrl}
        alt={decorative ? '' : alt}
        aria-hidden={decorative || undefined}
        className={cn('h-full w-full object-cover', imageClassName)}
        decoding="async"
      />
    </div>
  );
}
