import type { ReactNode } from "react";

export function highlightMatch(val: unknown, query?: string): ReactNode {
  if (val == null || val === "") return "";
  const str = String(val);
  if (!query || !query.trim()) return str;
  const q = query.trim();
  const lowerStr = str.toLowerCase();
  const lowerQ = q.toLowerCase();
  const matchIndex = lowerStr.indexOf(lowerQ);
  if (matchIndex === -1) return str;

  const parts: ReactNode[] = [];
  let startIndex = 0;
  let curr = matchIndex;
  let key = 0;
  while (curr !== -1) {
    if (curr > startIndex) {
      parts.push(str.slice(startIndex, curr));
    }
    parts.push(
      <mark
        key={key++}
        className="rounded-2xs bg-amber-300 text-black px-0.5 font-bold shadow-2xs dark:bg-amber-400 dark:text-black print:[background:transparent] print:p-0"
      >
        {str.slice(curr, curr + q.length)}
      </mark>
    );
    startIndex = curr + q.length;
    curr = lowerStr.indexOf(lowerQ, startIndex);
  }
  if (startIndex < str.length) {
    parts.push(str.slice(startIndex));
  }
  return <>{parts}</>;
}
