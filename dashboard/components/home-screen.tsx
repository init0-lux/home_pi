"use client";

import Link from "next/link";

import { useRoomsData } from "@/hooks/use-rooms-data";
import { RoomCard } from "@/components/room-card";

import { AppShell } from "./app-shell";

export function HomeScreen() {
  const { error, isFetching, isOnline, rooms, usingCache } = useRoomsData();

  return (
    <AppShell
      eyebrow="Local-First Hospitality Control"
      isOnline={isOnline}
      subtitle="A premium control surface for room operations, fast provisioning, and natural language automation across a property."
      title="Zapp PWA"
      usingCache={usingCache}
    >
      <section className="grid gap-4 md:grid-cols-[1.3fr,0.7fr]">
        <div className="rounded-[32px] border border-white/10 bg-slate-950/35 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Property Overview
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-white">
                Room orchestration with instant local feedback
              </h2>
            </div>
            <div className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm text-slate-200">
              {isFetching ? "Refreshing state..." : `${rooms.length} rooms loaded`}
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-3xl bg-white/6 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Provisioning</p>
              <p className="mt-3 text-lg font-semibold text-white">
                Manual AP flow with room assignment
              </p>
            </div>
            <div className="rounded-3xl bg-white/6 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Chat Control</p>
              <p className="mt-3 text-lg font-semibold text-white">
                MCP-ready natural language commands
              </p>
            </div>
            <div className="rounded-3xl bg-white/6 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Offline UX</p>
              <p className="mt-3 text-lg font-semibold text-white">
                Cached room state with disabled controls
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(247,201,132,0.16),rgba(255,255,255,0.05))] p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Quick Actions</p>
          <div className="mt-5 space-y-3">
            <Link
              className="block rounded-3xl bg-slate-950 px-5 py-4 text-sm font-semibold text-white transition hover:bg-slate-900"
              href="/provision"
            >
              Add a new relay or AC module
            </Link>
            <Link
              className="block rounded-3xl border border-white/10 bg-white/8 px-5 py-4 text-sm font-semibold text-slate-50 transition hover:bg-white/12"
              href="/chat"
            >
              Open LLM control chat
            </Link>
          </div>

          {error ? (
            <p className="mt-5 text-sm text-rose-200">{error.message}</p>
          ) : null}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rooms.map((room) => (
          <RoomCard key={room.roomId} room={room} />
        ))}
      </section>
    </AppShell>
  );
}
