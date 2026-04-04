"use client";

import type { ReactNode } from "react";

import { useDashboardStore } from "@/lib/store/dashboard-store";

import { InstallButton } from "./install-button";
import { Navigation } from "./navigation";
import { OfflineBanner } from "./offline-banner";

type AppShellProps = {
  children: ReactNode;
  eyebrow: string;
  isOnline: boolean;
  subtitle: string;
  title: string;
  usingCache?: boolean;
};

export function AppShell({
  children,
  eyebrow,
  isOnline,
  subtitle,
  title,
  usingCache = false,
}: AppShellProps) {
  const lastSyncAt = useDashboardStore((store) => store.lastSyncAt);

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden px-4 pb-6 pt-4 md:px-8 md:pb-8 md:pt-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(247,201,132,0.24),transparent_30%),radial-gradient(circle_at_top_right,rgba(122,197,255,0.18),transparent_34%),linear-gradient(180deg,#08111f_0%,#0b1324_38%,#111a2c_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_50%)]" />

      <header className="relative mx-auto w-full max-w-6xl">
        <div className="rounded-[36px] border border-white/10 bg-white/6 p-5 shadow-[0_24px_90px_rgba(8,15,28,0.35)] backdrop-blur-xl md:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-300">{eyebrow}</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white md:text-5xl">
                {title}
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-7 text-slate-300 md:text-base">
                {subtitle}
              </p>
            </div>

            <div className="flex flex-col items-start gap-3 md:items-end">
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/40 px-4 py-2 text-sm text-slate-100">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    isOnline ? "bg-emerald-300" : "bg-amber-300"
                  }`}
                />
                <span>{isOnline ? "Hub reachable" : "Offline cache mode"}</span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <InstallButton />
                <div className="rounded-full border border-white/10 px-3 py-2 text-xs text-slate-300">
                  Polling every 2.5s
                </div>
              </div>
            </div>
          </div>

          {!isOnline ? (
            <div className="mt-6">
              <OfflineBanner lastSyncAt={lastSyncAt} usingCache={usingCache} />
            </div>
          ) : null}
        </div>
      </header>

      <main className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 py-6 md:py-8">
        {children}
      </main>

      <div className="relative mx-auto w-full max-w-6xl">
        <Navigation />
      </div>
    </div>
  );
}
