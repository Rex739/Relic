import Link from "next/link";
import { BrandLogo } from "./BrandLogo";

export function Brand() {
  return (
    <Link href="/" className="focus-ring inline-flex min-w-[184px] items-center" aria-label="Go to Relic home">
      <BrandLogo variant="full" theme="light" />
    </Link>
  );
}
