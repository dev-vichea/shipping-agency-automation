import * as React from "react";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";

export type FileType = "pdf" | "excel" | "image" | "doc";

export interface FileTypeDetectInput {
  filename?: string | null;
  mime?: string | null;
  type?: string | null;
}

/**
 * Detects the file category (pdf, excel, image, doc) from a filename, mime type, or type string.
 */
export function detectFileType(input?: FileTypeDetectInput | string | null): FileType {
  if (!input) return "doc";

  const raw =
    typeof input === "string"
      ? input
      : [input.type, input.mime, input.filename].filter(Boolean).join(" ");
  const lower = raw.toLowerCase();

  if (lower.includes("pdf") || /\.pdf$/i.test(lower)) {
    return "pdf";
  }

  if (
    lower.includes("excel") ||
    lower.includes("spreadsheet") ||
    lower.includes("sheet") ||
    lower.includes("csv") ||
    lower.includes("cdc") ||
    /\.(?:xlsx?|xlsm|xlsb|csv|tsv)$/i.test(lower)
  ) {
    return "excel";
  }

  if (
    lower.includes("image") ||
    /\.(?:png|jpe?g|webp|gif|svg|bmp|tiff?)$/i.test(lower)
  ) {
    return "image";
  }

  return "doc";
}

export function fileTypeLabel(type: FileType): string {
  switch (type) {
    case "pdf":
      return "PDF document";
    case "excel":
      return "Excel spreadsheet";
    case "image":
      return "Image file";
    case "doc":
    default:
      return "Document";
  }
}

export const fileIconSizes = {
  xs: "size-3.5",
  sm: "size-4",
  md: "size-5",
  lg: "size-8",
  xl: "size-9",
} as const;

export type FileIconSize = keyof typeof fileIconSizes;

export interface FileIconBaseProps extends React.SVGProps<SVGSVGElement> {
  size?: FileIconSize;
}

/**
 * PDF Document Icon with folded corner sheet and red "PDF" badge.
 */
export function PdfFileIcon({
  className,
  size = "md",
  ...props
}: FileIconBaseProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 16 16"
      className={cn(fileIconSizes[size], "shrink-0 drop-shadow-xs", className)}
      aria-label="PDF file"
      {...props}
    >
      <path
        fill="#fff"
        stroke="#D0D5DD"
        strokeWidth="0.6"
        d="M13.997 15.7h-9.6a1.3 1.3 0 0 1-1.3-1.3V1.6a1.3 1.3 0 0 1 1.3-1.3h6.4c.048 0 .095.02.13.054l4.316 4.317c.035.034.054.08.054.129v9.6a1.3 1.3 0 0 1-1.3 1.3Z"
      />
      <path stroke="#D0D5DD" strokeWidth="0.6" d="M10.797.2v3a1.6 1.6 0 0 0 1.6 1.6h3" />
      <rect width="10.4" height="6.6" x="0.398" y="7.102" fill="#D92D20" rx="0.8" />
      <path
        fill="#fff"
        d="M1.934 11.902V8.993h1.148q.33 0 .564.127.233.125.355.348.124.221.124.511T4 10.49a.86.86 0 0 1-.362.346 1.2 1.2 0 0 1-.571.123h-.732v-.493h.632q.178 0 .293-.06a.4.4 0 0 0 .173-.173.54.54 0 0 0 .058-.254q0-.144-.058-.253a.4.4 0 0 0-.173-.169.63.63 0 0 0-.296-.06H2.55v2.405zm3.622 0H4.524V8.993h1.04q.44 0 .756.175.316.174.487.499.172.324.172.778t-.172.781a1.2 1.2 0 0 1-.49.502 1.56 1.56 0 0 1-.761.174m-.417-.527h.391a1 1 0 0 0 .459-.096.62.62 0 0 0 .281-.303q.095-.205.095-.531 0-.322-.095-.527a.62.62 0 0 0-.28-.301 1 1 0 0 0-.459-.097H5.14zm2.295.527V8.993h1.927V9.5H8.05v.694h1.183v.507H8.05v1.201z"
      />
    </svg>
  );
}

/**
 * Excel Spreadsheet Icon with folded corner sheet and green "XLS" badge.
 */
export function ExcelFileIcon({
  className,
  size = "md",
  badge = "XLS",
  ...props
}: FileIconBaseProps & { badge?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 16 16"
      className={cn(fileIconSizes[size], "shrink-0 drop-shadow-xs", className)}
      aria-label="Excel spreadsheet"
      {...props}
    >
      <path
        fill="#fff"
        stroke="#D0D5DD"
        strokeWidth="0.6"
        d="M13.997 15.7h-9.6a1.3 1.3 0 0 1-1.3-1.3V1.6a1.3 1.3 0 0 1 1.3-1.3h6.4c.048 0 .095.02.13.054l4.316 4.317c.035.034.054.08.054.129v9.6a1.3 1.3 0 0 1-1.3 1.3Z"
      />
      <path stroke="#D0D5DD" strokeWidth="0.6" d="M10.797.2v3a1.6 1.6 0 0 0 1.6 1.6h3" />
      <rect width="10.4" height="6.6" x="0.398" y="7.102" fill="#0F9755" rx="0.8" />
      <text
        x="5.6"
        y="10.5"
        fill="#fff"
        fontSize="3.6"
        fontWeight="800"
        fontFamily="system-ui, -apple-system, sans-serif"
        textAnchor="middle"
        dominantBaseline="central"
        letterSpacing="-0.2"
      >
        {badge}
      </text>
    </svg>
  );
}

/**
 * Image File Icon with folded corner sheet and blue "IMG" badge.
 */
export function ImageFileIcon({
  className,
  size = "md",
  ...props
}: FileIconBaseProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 16 16"
      className={cn(fileIconSizes[size], "shrink-0 drop-shadow-xs", className)}
      aria-label="Image file"
      {...props}
    >
      <path
        fill="#fff"
        stroke="#D0D5DD"
        strokeWidth="0.6"
        d="M13.997 15.7h-9.6a1.3 1.3 0 0 1-1.3-1.3V1.6a1.3 1.3 0 0 1 1.3-1.3h6.4c.048 0 .095.02.13.054l4.316 4.317c.035.034.054.08.054.129v9.6a1.3 1.3 0 0 1-1.3 1.3Z"
      />
      <path stroke="#D0D5DD" strokeWidth="0.6" d="M10.797.2v3a1.6 1.6 0 0 0 1.6 1.6h3" />
      <rect width="10.4" height="6.6" x="0.398" y="7.102" fill="#1570EF" rx="0.8" />
      <text
        x="5.6"
        y="10.5"
        fill="#fff"
        fontSize="3.6"
        fontWeight="800"
        fontFamily="system-ui, -apple-system, sans-serif"
        textAnchor="middle"
        dominantBaseline="central"
        letterSpacing="-0.2"
      >
        IMG
      </text>
    </svg>
  );
}

/**
 * Generic Document Icon with folded corner sheet and customizable badge.
 */
export function GenericDocIcon({
  className,
  size = "md",
  badge = "DOC",
  badgeColor = "#475467",
  ...props
}: FileIconBaseProps & { badge?: string; badgeColor?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 16 16"
      className={cn(fileIconSizes[size], "shrink-0 drop-shadow-xs", className)}
      aria-label="Document file"
      {...props}
    >
      <path
        fill="#fff"
        stroke="#D0D5DD"
        strokeWidth="0.6"
        d="M13.997 15.7h-9.6a1.3 1.3 0 0 1-1.3-1.3V1.6a1.3 1.3 0 0 1 1.3-1.3h6.4c.048 0 .095.02.13.054l4.316 4.317c.035.034.054.08.054.129v9.6a1.3 1.3 0 0 1-1.3 1.3Z"
      />
      <path stroke="#D0D5DD" strokeWidth="0.6" d="M10.797.2v3a1.6 1.6 0 0 0 1.6 1.6h3" />
      <rect width="10.4" height="6.6" x="0.398" y="7.102" fill={badgeColor} rx="0.8" />
      <text
        x="5.6"
        y="10.5"
        fill="#fff"
        fontSize="3.6"
        fontWeight="800"
        fontFamily="system-ui, -apple-system, sans-serif"
        textAnchor="middle"
        dominantBaseline="central"
        letterSpacing="-0.2"
      >
        {badge}
      </text>
    </svg>
  );
}

export interface FileTypeIconProps extends React.SVGProps<SVGSVGElement> {
  type?: string;
  filename?: string;
  mime?: string;
  size?: FileIconSize;
  badge?: string;
}

/**
 * Universal file type icon component.
 * Automatically resolves the file type from type, filename, or mime props.
 */
export function FileTypeIcon({
  type,
  filename,
  mime,
  size = "md",
  className,
  badge,
  ...props
}: FileTypeIconProps) {
  const resolved = detectFileType({ type, filename, mime });

  switch (resolved) {
    case "pdf":
      return <PdfFileIcon size={size} className={className} {...props} />;
    case "excel":
      return <ExcelFileIcon size={size} className={className} badge={badge} {...props} />;
    case "image":
      return <ImageFileIcon size={size} className={className} {...props} />;
    case "doc":
    default:
      return (
        <GenericDocIcon
          size={size}
          className={className}
          badge={badge ?? (filename?.split(".").pop()?.toUpperCase().slice(0, 3) || "DOC")}
          {...props}
        />
      );
  }
}

export interface FileAttachmentGroupProps {
  types?: string[];
  files?: Array<{ filename?: string; mime?: string; type?: string }>;
  count?: number;
  maxIcons?: number;
  size?: FileIconSize;
  className?: string;
}

/**
 * Displays a group of file type icons with clean overlap and a +N count badge for excess files.
 */
export function FileAttachmentGroup({
  types,
  files,
  count,
  maxIcons = 3,
  size = "md",
  className,
}: FileAttachmentGroupProps) {
  const resolvedTypes: FileType[] = React.useMemo(() => {
    if (files && files.length > 0) {
      return files.map((f) => detectFileType(f));
    }
    if (types && types.length > 0) {
      return types.map((t) => detectFileType(t));
    }
    const total = count ?? 0;
    if (total === 1) return ["pdf"];
    if (total === 2) return ["excel", "pdf"];
    if (total > 2) return ["excel", "pdf"];
    return [];
  }, [files, types, count]);

  const totalCount = count ?? files?.length ?? types?.length ?? resolvedTypes.length;

  if (totalCount === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  const visible = resolvedTypes.slice(0, maxIcons);
  const remaining = totalCount > visible.length ? totalCount - visible.length : 0;

  return (
    <div
      className={cn("inline-flex items-center justify-center gap-1", className)}
      title={`${totalCount} attachment(s)`}
    >
      <div className="inline-flex items-center justify-center -space-x-1.5 hover:space-x-1 transition-all">
        {visible.map((fileType, idx) => (
          <span
            key={idx}
            className="relative transition-transform hover:scale-115 hover:z-10"
            title={fileTypeLabel(fileType)}
          >
            <FileTypeIcon type={fileType} size={size} />
          </span>
        ))}
      </div>
      {remaining > 0 && (
        <span className="text-[11px] font-mono text-muted-foreground font-semibold pl-0.5">
          +{remaining}
        </span>
      )}
    </div>
  );
}

export interface FileAttachmentItem {
  id?: string;
  filename: string;
  mime?: string | null;
  size?: number | null;
  url?: string;
  classification?: string | null;
}

export interface FileAttachmentBadgeProps {
  filename: string;
  mime?: string | null;
  type?: string;
  size?: FileIconSize;
  href?: string;
  subtext?: string;
  className?: string;
}

/**
 * Single document badge / chip with icon, filename, and optional link.
 */
export function FileAttachmentBadge({
  filename,
  mime,
  type,
  size = "sm",
  href,
  subtext,
  className,
}: FileAttachmentBadgeProps) {
  const content = (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-md border border-border/80 bg-background/80 px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent/50",
        className
      )}
    >
      <FileTypeIcon filename={filename} mime={mime ?? undefined} type={type} size={size} />
      <span className="truncate max-w-[200px] font-medium">{filename}</span>
      {subtext && <span className="text-[11px] text-muted-foreground">{subtext}</span>}
    </div>
  );

  if (href) {
    return (
      <a href={href} className="inline-block focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-md">
        {content}
      </a>
    );
  }

  return content;
}

export interface FileAttachmentListProps {
  documents: FileAttachmentItem[];
  emptyMessage?: string;
  className?: string;
}

/**
 * Clean reusable list of document attachments with download links.
 */
export function FileAttachmentList({
  documents,
  emptyMessage = "No attachments",
  className,
}: FileAttachmentListProps) {
  if (!documents.length) {
    return <p className="px-4 py-3 text-body-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ul className={cn("divide-y divide-border/60", className)}>
      {documents.map(({ id, filename, mime, url }) => {
        const downloadUrl = url ?? (id ? `/api/v1/documents/${id}/download` : undefined);
        return (
          <li key={id ?? filename}>
            <a
              className="group flex items-center gap-3 px-4 py-2.5 hover:bg-accent/40 transition-colors focus-visible:-outline-offset-2"
              aria-label={`Download ${filename}`}
              href={downloadUrl}
            >
              <FileTypeIcon filename={filename} mime={mime ?? undefined} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="wrap-anywhere text-body-sm font-medium text-foreground group-hover:text-primary transition-colors">
                  {filename}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {fileTypeLabel(detectFileType({ filename, mime: mime ?? undefined }))}
                </p>
              </div>
              {downloadUrl && (
                <Download
                  size={15}
                  aria-hidden
                  className="shrink-0 text-muted-foreground group-hover:text-primary transition-colors"
                />
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
