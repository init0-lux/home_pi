"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

import { useRoomsData } from "@/hooks/use-rooms-data";
import { provisionDevice } from "@/lib/api";
import type { DeviceType } from "@/lib/contracts";

import { AppShell } from "./app-shell";

const deviceTypes: DeviceType[] = ["light", "fan", "ac"];

export function ProvisionScreen() {
  const router = useRouter();
  const { isOnline, rooms, usingCache } = useRoomsData();
  const [form, setForm] = useState({
    name: "New Device",
    password: "",
    roomId: "room-101",
    ssid: "",
    type: "light" as DeviceType,
  });

  const effectiveRoomId = rooms.length > 0 && !rooms.some(r => r.roomId === form.roomId)
    ? rooms[0].roomId
    : form.roomId;

  const mutation = useMutation({
    mutationFn: provisionDevice,
    onSuccess: (result) => {
      router.push(`/rooms/${result.roomId}`);
    },
  });

  return (
    <AppShell
      eyebrow="Step 2 of 3"
      isOnline={isOnline}
      subtitle="Bridge your device to your network with your credentials."
      title="Sync Hardware"
      usingCache={usingCache}
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={async (event) => {
          event.preventDefault();
          await mutation.mutateAsync({ ...form, roomId: effectiveRoomId });
        }}
      >
        <section className="bg-[rgba(32,31,31,0.4)] backdrop-blur-3xl rounded-lg border border-outline-variant/10 p-5">
          <label className="block text-[10px] uppercase tracking-widest font-bold text-primary-container mb-4">Network Connection</label>
          <div className="flex flex-col gap-3">
            <div className="relative">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"/>
              </svg>
              <input
                className="w-full bg-surface-container-lowest border-none rounded-xl py-3 pl-10 pr-4 text-xs text-on-surface focus:ring-1 focus:ring-primary-container transition-all outline-none"
                onChange={(event) =>
                  setForm((current) => ({ ...current, ssid: event.target.value }))
                }
                placeholder="WiFi Network Name"
                value={form.ssid}
                required
              />
            </div>
            <div className="relative">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
              </svg>
              <input
                className="w-full bg-surface-container-lowest border-none rounded-xl py-3 pl-10 pr-10 text-xs text-on-surface focus:ring-1 focus:ring-primary-container transition-all outline-none"
                onChange={(event) =>
                  setForm((current) => ({ ...current, password: event.target.value }))
                }
                placeholder="WiFi Password"
                type="password"
                value={form.password}
                required
              />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-end justify-between px-1">
            <label className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">Room Assignment</label>
          </div>
           <div className="grid grid-cols-2 gap-3">
             {rooms.map((room) => (
                <button
                  key={room.roomId}
                  type="button"
                  onClick={() => setForm((curr) => ({ ...curr, roomId: room.roomId }))}
                  className={`flex flex-col items-start gap-2 p-4 rounded-lg transition-all active:scale-95 ${
                    effectiveRoomId === room.roomId 
                      ? "bg-primary-container/10 border border-primary-container/30 text-primary-container"
                      : "bg-surface-container-low border border-transparent text-on-surface-variant hover:bg-surface-variant"
                  }`}
                >
                  <span className="text-xs font-bold truncate w-full text-left">{room.name}</span>
                </button>
             ))}
           </div>
        </section>

        <section className="bg-[rgba(32,31,31,0.4)] backdrop-blur-3xl rounded-lg border border-outline-variant/10 p-5 mt-2">
          <label className="block text-[10px] uppercase tracking-widest font-bold text-secondary-container mb-4">Device Config</label>
          <div className="flex flex-col gap-3">
            <select
                className="w-full bg-surface-container-lowest border-none rounded-xl py-3 px-4 text-xs text-on-surface focus:ring-1 focus:ring-secondary-container transition-all outline-none appearance-none"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    type: event.target.value as DeviceType,
                  }))
                }
                value={form.type}
              >
                {deviceTypes.map((type) => (
                  <option key={type} value={type} className="bg-surface">
                    {type.toUpperCase()}
                  </option>
                ))}
            </select>
            <input
              className="w-full bg-surface-container-lowest border-none rounded-xl py-3 px-4 text-xs text-on-surface focus:ring-1 focus:ring-secondary-container transition-all outline-none"
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Friendly Name (e.g. Bedside Light)"
              value={form.name}
              required
            />
          </div>
        </section>

        {mutation.error ? (
          <p className="mt-2 text-sm text-error">{mutation.error.message}</p>
        ) : null}

        <div className="flex items-start gap-3 p-4 rounded-xl bg-surface-container-low border border-outline-variant/10 mt-2">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5 text-primary-container shrink-0">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
           </svg>
           <p className="text-[11px] leading-relaxed text-on-surface-variant">
               Connecting sends config to local ESP. Device will reboot and register.
           </p>
        </div>

        <button
          className="w-full py-4 mt-2 rounded-2xl bg-gradient-to-r from-primary-container to-[#E6C200] text-on-primary-container font-headline font-bold text-lg tracking-wide shadow-[0_12px_24px_rgba(255,215,0,0.2)] active:scale-95 transition-all duration-200 uppercase disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!form.ssid || !form.password || mutation.isPending || !isOnline}
          type="submit"
        >
          {mutation.isPending ? "Sending..." : "Continue"}
        </button>
      </form>
    </AppShell>
  );
}
