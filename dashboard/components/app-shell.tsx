"use client";

import type { ReactNode } from "react";
import { useDashboardStore } from "@/lib/store/dashboard-store";
import { InstallButton } from "./install-button";
import { Navigation } from "./navigation";
import { OfflineBanner } from "./offline-banner";

type AppShellProps = {
  children: ReactNode;
  eyebrow?: string;
  isOnline: boolean;
  subtitle?: string;
  title?: string;
  usingCache?: boolean;
};

export function AppShell({
  children,
  eyebrow,
  isOnline,
  subtitle,
  title = "Zapp",
  usingCache = false,
}: AppShellProps) {
  const lastSyncAt = useDashboardStore((store) => store.lastSyncAt);

  return (
    <div className="mx-auto flex flex-col relative h-[100dvh] w-full max-w-md bg-surface overflow-hidden shadow-2xl">
      <header className="flex-none flex justify-between items-center px-6 py-4 bg-surface/80 backdrop-blur-xl z-50">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full cursor-pointer bg-surface-container-highest active:scale-90 transition-all duration-200">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-neutral-100">
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <h1 className="text-xl font-bold tracking-tighter text-neutral-100 font-headline">{title} ⚡</h1>
        </div>
        <div className="flex items-center justify-end gap-x-2">
          {!isOnline && <span className="w-2.5 h-2.5 rounded-full bg-error" />}
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-surface-container-highest text-primary-container hover:opacity-80 transition-opacity active:scale-95">
             <InstallButton />
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col px-6 overflow-y-auto pb-28">
        {(eyebrow || subtitle) && (
          <section className="mt-2 mb-4 flex-none">
            {subtitle && <p className="text-[10px] uppercase tracking-[0.3em] font-label font-semibold text-neutral-500 mb-1">{subtitle}</p>}
            {eyebrow && <h2 className="text-3xl font-headline font-extralight tracking-tight text-primary-container">{eyebrow}</h2>}
          </section>
        )}

        {!isOnline ? (
          <div className="mb-4">
            <OfflineBanner lastSyncAt={lastSyncAt} usingCache={usingCache} />
          </div>
        ) : null}

        {children}
      </main>

      <Navigation />
    </div>
  );
}
