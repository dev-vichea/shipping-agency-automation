import Link from "next/link";
import { Anchor } from "lucide-react";

export function Brand() {
  return (
    <Link href="/home" className="flex w-fit items-center gap-2.5 text-headline-sm">
      <span className="grid size-8 place-items-center rounded-control bg-primary text-primary-foreground">
        <Anchor aria-hidden size={18} />
      </span>
      <span>
        Harborway
        <span className="block text-body-sm text-muted-foreground">
          Shipping operations
        </span>
      </span>
    </Link>
  );
}
