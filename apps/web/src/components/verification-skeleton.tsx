import { Skeleton } from "@/components/ui/skeleton";

export function VerificationCardSkeleton() {
  return (
    <div className="w-full space-y-4 p-4 animate-in fade-in-50 duration-200">
      {/* Header Fields Skeleton */}
      <div className="grid grid-cols-2 gap-3.5 border-b border-border/60 pb-4">
        <div className="col-span-2 space-y-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-14 w-full" />
        </div>
        <div className="col-span-1 space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="col-span-1 space-y-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-14 w-full" />
        </div>
      </div>

      {/* Table Skeleton */}
      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between pb-1">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3.5 w-20" />
        </div>
        <div className="rounded border border-border/60 overflow-hidden">
          <div className="flex items-center gap-3 bg-muted/30 p-2 border-b border-border/60">
            <Skeleton className="h-3 w-6" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-16 ml-auto" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 p-2.5 border-b border-border/40 last:border-b-0">
              <Skeleton className="h-3 w-4" />
              <Skeleton className="h-3.5 w-48" />
              <Skeleton className="h-3.5 w-14 ml-auto" />
              <Skeleton className="h-3.5 w-10" />
              <Skeleton className="h-3.5 w-14" />
              <Skeleton className="h-3.5 w-18" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function VerificationWorkspaceSkeleton() {
  return (
    <div className="w-full space-y-4">
      {/* Top case header skeleton */}
      <div className="flex items-center justify-between border-b border-border/60 pb-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>

      {/* Split pane skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left card skeleton */}
        <div className="rounded-xl border border-border/80 bg-card shadow-xs overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border/60 p-3 bg-muted/20">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-12 ml-auto" />
          </div>
          <VerificationCardSkeleton />
        </div>

        {/* Right preview skeleton */}
        <div className="rounded-xl border border-border/80 bg-card shadow-xs p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-7 w-24" />
          </div>
          <div className="space-y-3 pt-4">
            <Skeleton className="h-8 w-48 mx-auto" />
            <Skeleton className="h-4 w-32 mx-auto" />
            <div className="grid grid-cols-2 gap-4 pt-6">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
            <div className="pt-6 space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
