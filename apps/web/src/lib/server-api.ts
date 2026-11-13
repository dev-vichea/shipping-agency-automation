import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Profile } from "./contracts";

export const api = cache(async <T,>(path: string): Promise<T> => {
  const session = (await cookies()).get("shipping_session");
  if (!session) redirect("/login");
  const origin = process.env.SHIPPING_INTERNAL_API_URL ?? "http://127.0.0.1:8001";
  const response = await fetch(`${origin}/api/v1${path}`, {
    cache: "no-store",
    headers: { Cookie: `shipping_session=${encodeURIComponent(session.value)}` },
    signal: AbortSignal.timeout(7_000),
  });
  if (response.status === 401) redirect("/login");
  if (response.status === 404 || response.status === 422) notFound();
  if (!response.ok) throw new Error("Workspace API unavailable");
  return response.json() as Promise<T>;
});

export const staffProfile = cache(() => api<Profile>("/auth/me"));
