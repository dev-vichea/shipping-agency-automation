import {
  ArrowUpRight,
  Building2,
  ChartNoAxesColumnIncreasing,
  ClipboardCheck,
  Coins,
  FileSpreadsheet,
  Files,
  Inbox,
  LayoutDashboard,
  PackageCheck,
  Plug,
  Scale,
  Settings,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export const SIDEBAR_COOKIE = "harborway_sidebar";

export type NavLink = {
  href: string;
  label: string;
  ariaLabel?: string;
  icon: LucideIcon;
  filtered: boolean;
  badge?: "needs_review" | "ready_for_approval" | "failed_runs";
};

export type NavGroupItem = {
  label: string;
  icon: LucideIcon;
  baseHref: string;
  items: NavLink[];
};

export type NavEntry =
  | { type: "link"; item: NavLink }
  | { type: "group"; group: NavGroupItem };

export type NavSection = {
  label: string;
  entries: NavEntry[];
};

export const navSections: NavSection[] = [
  {
    label: "Operations",
    entries: [
      {
        type: "link",
        item: {
          href: "/home",
          label: "Dashboard",
          ariaLabel: "Home",
          icon: LayoutDashboard,
          filtered: true,
        },
      },
      {
        type: "group",
        group: {
          label: "Document",
          icon: Files,
          baseHref: "/review",
          items: [
            {
              href: "/inbox",
              label: "Inbox",
              ariaLabel: "Inbox",
              icon: Inbox,
              filtered: true,
            },
            {
              href: "/review",
              label: "Intake cases",
              ariaLabel: "Intake cases",
              icon: Files,
              filtered: true,
              badge: "needs_review",
            },
            {
              href: "/approvals",
              label: "Approvals",
              ariaLabel: "Approvals",
              icon: ClipboardCheck,
              filtered: true,
              badge: "ready_for_approval",
            },
          ],
        },
      },
      {
        type: "link",
        item: {
          href: "/imports",
          label: "Import",
          ariaLabel: "Import records",
          icon: PackageCheck,
          filtered: true,
        },
      },
      {
        type: "link",
        item: {
          href: "/imports?tab=export",
          label: "Export",
          ariaLabel: "Export",
          icon: ArrowUpRight,
          filtered: true,
        },
      },
      {
        type: "link",
        item: {
          href: "/cdc",
          label: "CDC Lists",
          ariaLabel: "CDC Master Lists",
          icon: Scale,
          filtered: true,
        },
      },
      {
        type: "group",
        group: {
          label: "Report",
          icon: ChartNoAxesColumnIncreasing,
          baseHref: "/reports",
          items: [
            {
              href: "/reports",
              label: "Reports",
              ariaLabel: "Reports",
              icon: ChartNoAxesColumnIncreasing,
              filtered: true,
            },
            {
              href: "/reports?excel=true",
              label: "Excel Audit",
              ariaLabel: "Excel Audit",
              icon: FileSpreadsheet,
              filtered: true,
            },
          ],
        },
      },
      {
        type: "link",
        item: {
          href: "/cdc?tab=balance",
          label: "Balance",
          ariaLabel: "Balance",
          icon: Coins,
          filtered: true,
        },
      },
    ],
  },
  {
    label: "Management",
    entries: [
      {
        type: "link",
        item: {
          href: "/companies",
          label: "Companies",
          ariaLabel: "Companies",
          icon: Building2,
          filtered: false,
        },
      },
      {
        type: "link",
        item: {
          href: "/automation",
          label: "Automation",
          ariaLabel: "Automation runs",
          icon: Workflow,
          filtered: true,
          badge: "failed_runs",
        },
      },
      {
        type: "link",
        item: {
          href: "/integrations",
          label: "Integrations",
          ariaLabel: "Integrations",
          icon: Plug,
          filtered: false,
        },
      },
      {
        type: "link",
        item: {
          href: "/settings",
          label: "Settings",
          ariaLabel: "Settings",
          icon: Settings,
          filtered: false,
        },
      },
    ],
  },
];

export const navGroups = navSections.map((sec) => ({
  label: sec.label,
  links: sec.entries.flatMap((entry) => (entry.type === "link" ? [entry.item] : entry.group.items)),
}));

export const navLinks: NavLink[] = navSections.flatMap((section) =>
  section.entries.flatMap((entry) => (entry.type === "link" ? [entry.item] : entry.group.items))
);

export function isActiveRoute(pathname: string, href: string) {
  const urlPath = href.split("?")[0];
  return pathname === urlPath || (urlPath !== "/home" && pathname.startsWith(`${urlPath}/`));
}
