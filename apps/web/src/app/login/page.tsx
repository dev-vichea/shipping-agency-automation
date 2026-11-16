import type { Metadata } from "next";
import { Brand } from "@/components/workspace";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { LoginForm } from "@/components/forms";

export const metadata: Metadata = { title: "Staff sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = (await searchParams).next;
  const destination = typeof next === "string" &&
    (/^\/(?:review|approvals\/quick)\/[0-9a-f-]{36}(?:\?revision=\d{1,8}&review=[0-9a-f-]{36})?$/i.test(next) ||
     /^\/open\/[0-9a-f-]{36}\?workspace=[0-9a-f-]{36}(?:&revision=\d{1,8}&review=[0-9a-f-]{36})?$/i.test(next))
    ? next : undefined;
  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-card px-page py-4 text-foreground lg:px-page-desktop">
        <Brand />
      </header>
      <div className="grid flex-1 place-items-center px-page py-6">
        <Card className="w-full max-w-sm gap-0 py-0">
          <CardHeader className="border-b bg-background p-4">
            <h1 className="text-headline-lg">Staff sign in</h1>
            <p className="text-body-sm text-muted-foreground">Sign in with your work email.</p>
          </CardHeader>
          <CardContent className="p-4"><LoginForm destination={destination} /></CardContent>
        </Card>
      </div>
    </main>
  );
}
