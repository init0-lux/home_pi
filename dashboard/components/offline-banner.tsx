type OfflineBannerProps = {
  lastSyncAt: number | null;
  usingCache: boolean;
};

export function OfflineBanner({
  lastSyncAt,
  usingCache,
}: OfflineBannerProps) {
  return (
    <div className="rounded-3xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-50 shadow-[0_12px_40px_rgba(245,158,11,0.16)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-300" />
        <span className="font-semibold">Connection lost</span>
        <span className="text-amber-100/80">
          {usingCache
            ? "Showing cached room state until the hub comes back."
            : "Controls are paused until the hub reconnects."}
        </span>
      </div>
      {lastSyncAt ? (
        <p className="mt-2 text-xs text-amber-100/70">
          Last synced at {new Date(lastSyncAt).toLocaleTimeString()}.
        </p>
      ) : null}
    </div>
  );
}
