export default function LoadingWorkspace() {
  return <div role="status" aria-label="Loading workspace" className="space-y-5 motion-safe:animate-pulse">
    <div className="h-7 w-46 rounded-md bg-border"></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => <div key={index} className="panel h-24 bg-muted"></div>)}
    </div>
    <div className="panel h-60 bg-muted"></div>
  </div>;
}
