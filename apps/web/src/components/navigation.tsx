"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { write } from "@/lib/client-api";

export function SignOut() {
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    setError(false);
    try {
      await write("/auth/logout");
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Clear the router cache when the session changes.
      window.location.assign("/login");
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  return <>
    <DropdownMenuItem disabled={busy} onSelect={(event) => { event.preventDefault(); void logout(); }}>
      <LogOut aria-hidden /> {busy ? "Signing out…" : "Sign out"}
    </DropdownMenuItem>
    {error && <p role="alert" className="field-error mx-1 my-1">Sign out failed.</p>}
  </>;
}
