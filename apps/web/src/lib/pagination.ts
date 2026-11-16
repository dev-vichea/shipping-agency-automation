export const pageSize = 30;
export const maxOffset = 99_990;

export function parseOffset(value?: string | string[]) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 0;
  const offset = Number(value);
  return offset <= maxOffset ? offset : 0;
}

export function pageWindow<T>(results: T[]) {
  return { items: results.slice(0, pageSize), hasNext: results.length > pageSize };
}

export function lastPageOffset(total: number, size = pageSize) {
  return Math.max(0, Math.ceil(total / size) - 1) * size;
}

export function pageHref(path: string, offset: number) {
  const [route, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  if (offset > 0) params.set("offset", String(offset));
  else params.delete("offset");
  return params.size ? `${route}?${params}` : route;
}
