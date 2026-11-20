import { Download, File, FileSpreadsheet, FileText } from "lucide-react";
import type { Document } from "@/lib/contracts";
import { cn } from "@/lib/utils";

export function Originals({ documents }: { documents: Document[] }) {
  if (!documents.length) return <p className="px-4 py-3 text-body-sm text-muted-foreground">No attachments</p>;
  return (
    <ul className="divide-y">
      {documents.map(({ id, original_filename: filename, mime }) => {
        const isPdf = mime === "application/pdf" || /\.pdf$/i.test(filename);
        const isSpreadsheet = /\.(?:xlsx?|xlsm|xlsb|csv|tsv)$/i.test(filename);
        const Icon = isPdf ? FileText : isSpreadsheet ? FileSpreadsheet : File;
        return (
          <li key={id}>
            <a
              className="group flex items-center gap-3 px-4 py-2.5 hover:bg-background focus-visible:-outline-offset-2"
              aria-label={`Download ${filename}`}
              href={`/api/v1/documents/${id}/download`}
            >
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-control",
                isPdf ? "bg-danger-fill text-destructive" : isSpreadsheet
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  : "bg-accent text-primary")}>
                <Icon size={18} aria-hidden />
              </span>
              <span className="min-w-0 flex-1 wrap-anywhere text-body-sm font-medium">{filename}</span>
              <Download size={15} aria-hidden className="shrink-0 text-muted-foreground group-hover:text-primary" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
