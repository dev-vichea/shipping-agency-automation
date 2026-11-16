import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { OpenInWorkspace } from "@/components/workspace-forms";
import { Brand } from "@/components/workspace";
import { companyParam } from "@/lib/scope";
import { workspaceList } from "@/lib/server-api";

export default async function OpenDraft({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ workspace?: string; revision?: string; review?: string; decision?: string }>;
}) {
  const id = companyParam((await params).id);
  if (!id) notFound();
  const { revision, review, workspace, decision } = await searchParams;
  const workspaceId = companyParam(workspace);
  const reviewId = companyParam(review);
  const revis = typeof revision === "string" && /^\d{1,8}$/.test(revision) ? revision : "";
  const quick = !!(reviewId && revis);
  const intent = decision === "reject" ? "&decision=reject" : "";
  const revisionQuery = quick ? `revision=${revis}&review=${reviewId}${intent}` : "";
  const destination = quick ? `/approvals/quick/${id}?${revisionQuery}` : `/review/${id}`;
  if (!(await cookies()).get("shipping_session")) {
    const query = workspaceId ? `?workspace=${workspaceId}${quick ? `&${revisionQuery}` : ""}` : "";
    const next = workspaceId ? `/open/${id}${query}` : destination;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  if (workspaceId) {
    const list = await workspaceList();
    const target = list.workspaces.find((entry) => entry.id === workspaceId);
    if (!target) notFound();
    if (list.active_id !== workspaceId) return <main className="mx-auto max-w-lg space-y-4 p-5 pt-12">
      <Brand />
      <section className="panel space-y-4 p-5">
        <h1 className="text-headline-lg">Open draft in {target.name}</h1>
        <OpenInWorkspace id={workspaceId} destination={destination} />
      </section>
    </main>;
  }
  redirect(destination);
}
