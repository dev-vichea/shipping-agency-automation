"use client";

import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormError, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { write } from "@/lib/client-api";
import { useFormSubmission } from "@/lib/use-form-submission";

export function LoginForm({ destination = "/home" }: { destination?: string }) {
  const { error, busy, submit } = useFormSubmission();
  function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void submit(async () => {
      await write("/auth/login", Object.fromEntries(form));
      window.location.assign(destination);
    });
  }
  return <form method="post" onSubmit={handle} className="space-y-3">
    <FormField id="email" label="Work email"><Input id="email" name="email" type="email" autoComplete="username" required /></FormField>
    <FormField id="password" label="Password"><Input id="password" name="password" type="password" autoComplete="current-password" maxLength={128} required /></FormField>
    <FormError error={error} />
    <Button className="w-full" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
  </form>;
}
