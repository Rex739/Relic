import Image from "next/image";
import { cn } from "@/lib/relic/utils";

type BrandTheme = "light" | "dark";

type BrandMarkProps = {
  className?: string;
  theme?: BrandTheme;
  size?: number;
};

export function BrandMark({ className, theme = "light", size = 32 }: BrandMarkProps) {
  const source = theme === "dark" ? "/brand/RelicMarkDark.svg" : "/brand/RelicMarkLight.svg";

  return (
    <Image
      src={source}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      priority={size >= 40}
    />
  );
}
