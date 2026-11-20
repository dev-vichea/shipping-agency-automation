import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { WorkspaceShell } from "@/features/workspace/workspace-shell";
import type { Company, Overview } from "@/lib/contracts";
import { api, staffProfile, workspaceList } from "@/lib/server-api";
import { SIDEBAR_COOKIE } from "@/features/workspace/workspace-navigation";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const [staff, workspace, companies, counts, jar] = await Promise.all([
    staffProfile(), workspaceList(), api<Company[]>("/companies?limit=100"), api<Overview>("/workspace/overview"), cookies(),
  ]);
  return <WorkspaceShell profile={staff} companies={companies} workspace={workspace} counts={counts}
    initiallyExpanded={jar.get(SIDEBAR_COOKIE)?.value !== "collapsed"}>
    {children}
  </WorkspaceShell>;
}
