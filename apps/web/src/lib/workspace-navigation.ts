import {
  Building2, ChartNoAxesColumnIncreasing, ClipboardCheck, Files, House,
  Inbox, PackageCheck, Plug, Scale, Settings, Workflow,
} from "lucide-react";

export const SIDEBAR_COOKIE = "harborway_sidebar";

export const navGroups = [
  {
    label: "Operations",
    links: [
      { href: "/home", label: "Home", icon: House, filtered: true },
      { href: "/inbox", label: "Inbox", icon: Inbox, filtered: true },
      { href: "/review", label: "Intake cases", icon: Files, filtered: true },
      { href: "/imports", label: "Import records", icon: PackageCheck, filtered: true },
      { href: "/approvals", label: "Approvals", icon: ClipboardCheck, filtered: true },
      { href: "/automation", label: "Automation runs", icon: Workflow, filtered: true },
    ],
  },
  {
    label: "Management",
    links: [
      { href: "/companies", label: "Companies", icon: Building2, filtered: false },
      { href: "/cdc", label: "CDC Master Lists", icon: Scale, filtered: true },
      { href: "/reports", label: "Reports", icon: ChartNoAxesColumnIncreasing, filtered: true },
      { href: "/integrations", label: "Integrations", icon: Plug, filtered: false },
      { href: "/settings", label: "Settings", icon: Settings, filtered: false },
    ],
  },
];

export const navLinks = navGroups.flatMap((group) => group.links);

export function isActiveRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
