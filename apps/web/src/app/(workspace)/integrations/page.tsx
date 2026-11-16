import type { Metadata } from "next";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Send } from "lucide-react";
import { TelegramLinkForm, UnlinkTelegram } from "@/components/integration-forms";
import { IntakeSources } from "@/components/intake-sources";
import { Badge } from "@/components/ui/badge";
import { Empty, PageHeading, Section } from "@/components/workspace";
import type { Company, FolderSource, Integrations, StaffMember } from "@/lib/contracts";
import { api, workspaceList } from "@/lib/server-api";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ gmail?: string }> }) {
  const workspace = await workspaceList();
  const notice = (await searchParams).gmail;
  const admin = workspace.workspaces.some(({ id, role }) => id === workspace.active_id && role === "admin");
  if (!admin) return <div className="space-y-4"><PageHeading title="Integrations" /><Section title="Provider access"><Empty>Workspace administrators manage integrations.</Empty></Section></div>;
  const [{ gmail, telegram }, companies, members, folders] = await Promise.all([
    api<Integrations>("/integrations"), api<Company[]>("/companies?limit=100"), api<StaffMember[]>("/workspace/members"),
    api<FolderSource[]>("/integrations/folders"),
  ]);
  return <div className="space-y-4">
    <PageHeading title="Integrations" />
    {notice === "connection_failed" && <p className="field-error" role="alert">Gmail could not be connected. Start the authorization again.</p>}
    <IntakeSources gmail={gmail} companies={companies} folders={folders}
      macAppAvailable={existsSync(join(process.cwd(), "public", "harborway-folder-intake-mac.zip"))} />
    <Section title="Notifications" action={<Badge variant="outline">{telegram.configured ? telegram.recipients.length ? "Linked" : "Ready" : "Disconnected"}</Badge>}>
        <div className="space-y-3 p-4">
          <h3 className="flex items-center gap-2 text-label-lg"><Send size={18} className="text-primary" aria-hidden /> Telegram</h3>
          {telegram.configured
            ? <TelegramLinkForm members={members} botUsername={telegram.bot_username} />
            : <p className="text-muted-foreground">Configure the agency bot token on the server before linking private chats.</p>}
          {telegram.configured && !telegram.mini_app && <p className="text-xs text-muted-foreground">
            Telegram Mini App buttons require a reachable HTTPS workspace address.
          </p>}
        </div>
        {telegram.recipients.length > 0 && <ul className="divide-y border-t">
          {telegram.recipients.map((entry) => <li key={entry.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
            <div className="min-w-0 break-all"><p className="font-medium">{entry.display_name}</p><p className="text-xs text-muted-foreground">{entry.email}</p></div>
            <UnlinkTelegram id={entry.id} name={entry.display_name} />
          </li>)}
        </ul>}
    </Section>
  </div>;
}
