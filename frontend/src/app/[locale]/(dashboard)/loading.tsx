export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-10 w-64 max-w-full rounded-2xl bg-black/5 animate-pulse" />
        <div className="h-5 w-[28rem] max-w-full rounded-2xl bg-black/5 animate-pulse" />
      </div>

      <div className="grid gap-6">
        <div className="h-44 rounded-[28px] zen-surface-subtle animate-pulse" />
        <div className="h-72 rounded-[28px] zen-surface-subtle animate-pulse" />
      </div>
    </div>
  );
}
