export function companyParam(value: string | string[] | undefined) {
  return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value : "";
}

export function scopedPath(path: string, companyId?: string) {
  if (!companyId) return path;
  const [route, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set("company_id", companyId);
  return `${route}?${params}`;
}
