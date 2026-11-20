"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Truck, Users, Navigation } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/fleet", label: "Vehicles & Chassis", icon: Truck },
  { href: "/fleet/drivers", label: "Drivers", icon: Users },
  { href: "/fleet/dispatches", label: "Active Trips", icon: Navigation },
];

export function FleetTabs() {
  const pathname = usePathname();

  return (
    <nav
      className="flex border-b bg-background px-2 overflow-x-auto no-scrollbar"
      aria-label="Fleet navigation tabs"
    >
      {tabs.map((tab) => {
        const active =
          tab.href === "/fleet"
            ? pathname === "/fleet"
            : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "cursor-pointer border-b-2 px-4 py-2.5 text-xs font-semibold transition-all focus-visible:outline-offset-[-2px] flex items-center gap-2 whitespace-nowrap",
              active
                ? "border-primary text-primary font-bold"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            )}
          >
            <tab.icon size={15} aria-hidden />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
