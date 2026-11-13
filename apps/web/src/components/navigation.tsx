"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { write } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { Inbox, ListChecks, Package, Workflow } from "lucide-react";

const sections = [
  { href: "/inbox", text: "Inbox", icon: Inbox },
  { href: "/review", text: "Review", icon: ListChecks },
  { href: "/imports", text: "Imports", icon: Package },
  { href: "/automation", text: "Automation", icon: Workflow },
];

export function Navigation() {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace" className="flex flex-wrap gap-x-1 sm:gap-x-4">
      {sections.map(({ href, text, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-1.5 border-b-2 px-2 py-3 text-sm font-medium sm:px-3",
              active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <Icon size={16} aria-hidden /> {text}
          </Link>
        );
      })}
    </nav>
  );
}

export function SignOut() {
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    setError(false);
    try {
      await write("/auth/logout");
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Clear the router cache when the session changes.
      window.location.assign("/login");
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  return <div><Button variant="outline" size="sm" onClick={logout} disabled={busy}>Sign out</Button>{error && <p role="alert" className="mt-1 text-xs text-destructive">Sign out failed.</p>}</div>;
}
