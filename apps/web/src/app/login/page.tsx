import type { Metadata } from "next";
import { Brand } from "@/components/workspace";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/forms";

export const metadata: Metadata = { title: "Staff sign in" };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md space-y-7">
        <Brand />
        <Card className="shadow-sm">
          <CardHeader><CardTitle><h1 className="text-xl">Staff sign in</h1></CardTitle>
            <CardDescription>Sign in with your internal staff account.</CardDescription></CardHeader>
          <CardContent><LoginForm /></CardContent>
        </Card>
      </div>
    </main>
  );
}
