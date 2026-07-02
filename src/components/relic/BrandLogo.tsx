import Image from "next/image";
import { cn } from "@/lib/relic/utils";
import { BrandMark } from "./BrandMark";

type BrandLogoVariant = "mark" | "compact" | "full";
type BrandLogoTheme = "light" | "dark";

type BrandLogoProps = {
  className?: string;
  variant?: BrandLogoVariant;
  theme?: BrandLogoTheme;
};

export function BrandLogo({ className, variant = "full", theme = "light" }: BrandLogoProps) {
  if (variant === "mark") {
    return <BrandMark className={className} theme={theme} size={36} />;
  }

  const source = theme === "dark" ? "/brand/RelicLogoDark.svg" : "/brand/RelicLogoLight.svg";
  const dimensions = variant === "compact" ? { width: 142, height: 34 } : { width: 184, height: 44 };

  return (
    <Image
      src={source}
      alt="Relic"
      width={dimensions.width}
      height={dimensions.height}
      className={cn(
        "block shrink-0 object-contain",
        variant === "compact" ? "h-[34px] w-[142px]" : "h-[44px] w-[184px]",
        className,
      )}
      priority
    />
  );
}
