export async function apiRequest<T>(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: FormData | object,
  signal?: AbortSignal
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      signal,
      headers: body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {},
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Could not reach the workspace. Try again.");
  }
  if (response.status === 401 && path !== "/auth/login") {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Clear the router cache when the session changes.
    window.location.assign("/login");
    throw new Error("Your session has expired.");
  }
  if (!response.ok) {
    const data: { detail?: unknown } | null = await response.json().catch(() => null);
    throw new Error(typeof data?.detail === "string" ? data.detail : "The request could not be completed.");
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export async function write<T>(path: string, body?: FormData | object, signal?: AbortSignal): Promise<T> {
  return apiRequest<T>(path, "POST", body, signal);
}
