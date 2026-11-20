import Link from "next/link";
import { ArrowRight, Building2, Files, PackageCheck, Pencil, Scale, Workflow } from "lucide-react";
import { CompanyForm, CompanyStaffForm } from "@/features/companies/company-forms";
import { FormSheet } from "@/components/ui/form-sheet";
import { Empty, PageHeading, Section, Status } from "@/components/ui/page-layout";
import type { CaseSummary, CompanyDetail, StaffMember } from "@/lib/contracts";
import { scopedPath } from "@/lib/scope";
import { api, workspaceList } from "@/lib/server-api";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await workspaceList();
  const admin = workspace.workspaces.some((entry) => entry.id === workspace.active_id && entry.role === "admin");
  const [company, cases, staff] = await Promise.all([
    api<CompanyDetail>(`/companies/${encodeURIComponent(id)}`),
    api<CaseSummary[]>(scopedPath("/intakes?limit=5", id)),
    admin ? api<StaffMember[]>("/workspace/members") : Promise.resolve([]),
  ]);
  const links = [
    { href: "/review", title: "Intake & documents", icon: Files },
    { href: "/imports", title: "Import records", icon: PackageCheck },
    { href: "/cdc", title: "CDC Master Lists", icon: Scale },
    { href: "/automation", title: "Processing history", icon: Workflow },
  ];
  return <div className="space-y-4">
    <Link href="/companies" className="data-link text-xs">All companies</Link>
    <PageHeading title={company.name} action={admin && <FormSheet title="Edit company" trigger={<><Pencil aria-hidden /> Edit company</>} outline><CompanyForm company={company} /></FormSheet>} />
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {links.map(({ href, title, icon: Icon }) => <Link key={href} href={scopedPath(href, id)} className="panel flex min-h-16 items-center gap-2 px-3 py-2 font-medium hover:border-focus">
        <Icon size={16} aria-hidden className="shrink-0 text-primary" />{title}<ArrowRight size={14} aria-hidden className="ml-auto shrink-0 text-muted-foreground" />
      </Link>)}
    </div>
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <Section title="Company details" action={<Building2 size={15} aria-hidden className="text-primary" />}>
        <dl className="grid gap-3 p-4 sm:grid-cols-2">{[
          ["Identifier", company.identifier], ["Aliases", company.aliases.join(", ")], ["Contact name", company.contact_name], ["Contact email", company.contact_email],
        ].map(([title, value]) => <div key={title}><dt className="text-xs text-muted-foreground">{title}</dt><dd className="mt-1 font-medium break-words">{value || "—"}</dd></div>)}</dl>
      </Section>
      <Section title="Recent cases">
        {cases.length ? <ul className="divide-y">{cases.map((item) => <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
          <Link href={`/review/${item.id}`} className="data-link truncate">{item.detected_reference ?? item.subject ?? item.id.slice(0, 8)}</Link><Status value={item.state} />
        </li>)}</ul> : <Empty>No intakes for this company.</Empty>}
      </Section>
      <Section title="Assigned staff">
        {company.staff.length > 0 && <ul className="space-y-1 p-4">{company.staff.map((member) => <li key={member.id} className="break-all">{member.email}</li>)}</ul>}
        {admin
          ? <div className="p-4"><CompanyStaffForm companyId={id} members={staff} assigned={company.staff.map((entry) => entry.id)} /></div>
          : !company.staff.length && <Empty>No operators assigned.</Empty>}
      </Section>
    </div>
  </div>;
}
