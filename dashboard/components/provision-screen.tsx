"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

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

  const mutation = useMutation({
    mutationFn: provisionDevice,
    onSuccess: (result) => {
      router.push(`/rooms/${result.roomId}`);
    },
  });

  return (
    <AppShell
      eyebrow="Provisioning Flow"
      isOnline={isOnline}
      subtitle="Manual ESP onboarding flow for AP-mode configuration, Wi-Fi credentials, and room assignment."
      title="Add Device"
      usingCache={usingCache}
    >
      <section className="grid gap-4 lg:grid-cols-[0.8fr,1.2fr]">
        <div className="rounded-[32px] border border-white/10 bg-slate-950/35 p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Manual Step</p>
          <h2 className="mt-3 text-2xl font-semibold text-white">Connect to the ESP access point</h2>
          <ol className="mt-5 space-y-4 text-sm leading-7 text-slate-300">
            <li>1. Power the module and wait for the device AP to appear on your phone.</li>
            <li>2. Join the ESP Wi-Fi manually. Browsers cannot switch networks for you.</li>
            <li>3. Return here, enter local Wi-Fi credentials, and assign the room.</li>
          </ol>
          <div className="mt-6 rounded-3xl border border-dashed border-white/15 bg-white/5 p-4 text-sm text-slate-300">
            Suggested AP name: <span className="font-semibold text-white">Zapp-Setup-XXXX</span>
          </div>
        </div>

        <form
          className="rounded-[32px] border border-white/10 bg-white/6 p-6 shadow-[0_20px_80px_rgba(8,15,28,0.28)]"
          onSubmit={async (event) => {
            event.preventDefault();
            await mutation.mutateAsync(form);
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm text-slate-200">
              <span className="font-medium">Wi-Fi SSID</span>
              <input
                className="w-full rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3 text-white outline-none transition focus:border-white/25"
                onChange={(event) =>
                  setForm((current) => ({ ...current, ssid: event.target.value }))
                }
                placeholder="Property Wi-Fi"
                value={form.ssid}
              />
            </label>
            <label className="space-y-2 text-sm text-slate-200">
              <span className="font-medium">Wi-Fi Password</span>
              <input
                className="w-full rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3 text-white outline-none transition focus:border-white/25"
                onChange={(event) =>
                  setForm((current) => ({ ...current, password: event.target.value }))
                }
                placeholder="••••••••"
                type="password"
                value={form.password}
              />
            </label>
            <label className="space-y-2 text-sm text-slate-200">
              <span className="font-medium">Room</span>
              <select
                className="w-full rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3 text-white outline-none transition focus:border-white/25"
                onChange={(event) =>
                  setForm((current) => ({ ...current, roomId: event.target.value }))
                }
                value={form.roomId}
              >
                {rooms.map((room) => (
                  <option key={room.roomId} value={room.roomId}>
                    {room.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm text-slate-200">
              <span className="font-medium">Device Type</span>
              <select
                className="w-full rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3 text-white outline-none transition focus:border-white/25"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    type: event.target.value as DeviceType,
                  }))
                }
                value={form.type}
              >
                {deviceTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="mt-4 block space-y-2 text-sm text-slate-200">
            <span className="font-medium">Friendly Name</span>
            <input
              className="w-full rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3 text-white outline-none transition focus:border-white/25"
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Bedside Light"
              value={form.name}
            />
          </label>

          {mutation.error ? (
            <p className="mt-4 text-sm text-rose-200">{mutation.error.message}</p>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100 disabled:opacity-60"
              disabled={!form.ssid || !form.password || mutation.isPending || !isOnline}
              type="submit"
            >
              {mutation.isPending ? "Sending config..." : "Send Config"}
            </button>
            <p className="text-sm text-slate-300">
              Device will reboot, auto-register, and redirect into the assigned room.
            </p>
          </div>
        </form>
      </section>
    </AppShell>
  );
}
