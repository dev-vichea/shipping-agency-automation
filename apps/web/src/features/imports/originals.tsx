import type { Document } from "@/lib/contracts";
import { FileAttachmentList } from "@/components/ui/file-icon";

export function Originals({ documents }: { documents: Document[] }) {
  return (
    <FileAttachmentList
      documents={documents.map((d) => ({
        id: d.id,
        filename: d.original_filename,
        mime: d.mime,
      }))}
    />
  );
}
