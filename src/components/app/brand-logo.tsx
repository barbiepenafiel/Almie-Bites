import Image from "next/image";
import { cn } from "@/lib/utils";

export const DEFAULT_LOGO = "/brand/almie-bites-logo.png";

/** Round Almie Bites badge. Uses the uploaded logo from Settings when there is one. */
export function BrandLogo({ src, size = 36, className, priority }: { src?: string | null; size?: number; className?: string; priority?: boolean }) {
  return (
    <Image
      src={src || DEFAULT_LOGO}
      alt="Almie Bites logo"
      width={size}
      height={size}
      priority={priority}
      unoptimized={!!src}
      className={cn("shrink-0 rounded-full object-cover", className)}
      style={{ width: size, height: size }}
    />
  );
}
