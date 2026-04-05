"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { DeviceCard } from "@/components/device-card";
import { useRoomData } from "@/hooks/use-room-data";
import { useSetDeviceState } from "@/hooks/use-set-device-state";
import { queryKeys } from "@/lib/query-keys";
import { countActiveDevices, formatRoomLabel } from "@/lib/utils";

import { AppShell } from "./app-shell";

type RoomScreenProps = {
  roomId: string;
};

export function RoomScreen({ roomId }: RoomScreenProps) {
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const { error, isFetching, isOnline, room, usingCache } = useRoomData(roomId);
  const mutation = useSetDeviceState();

  const sortedDevices = useMemo(
    () =>
      room?.devices.toSorted((left, right) => left.name.localeCompare(right.name)) ?? [],
    [room?.devices],
  );
  
  const activeCount = room ? countActiveDevices(room.devices) : 0;

  const handleDeviceAction = async (deviceId: string, nextState: "ON" | "OFF") => {
    if (!room) {
      return;
    }

    setPendingIds((current) => [...current, deviceId]);

    try {
      await mutation.mutateAsync({
        deviceId,
        roomId: room.roomId,
        state: nextState,
      });
    } finally {
      setPendingIds((current) => current.filter((id) => id !== deviceId));
    }
  };

  const toggleAll = async (state: "ON" | "OFF") => {
    if (!room) {
      return;
    }

    const targetDevices = room.devices.filter((device) => device.state !== state);
    setPendingIds(targetDevices.map((device) => device.deviceId));

    try {
      await Promise.all(
        targetDevices.map((device) =>
          mutation.mutateAsync({
            deviceId: device.deviceId,
            roomId: room.roomId,
            state,
          }),
        ),
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.room(room.roomId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.rooms });
    } finally {
      setPendingIds([]);
    }
  };
  
  const formattedId = formatRoomLabel(roomId);

  return (
    <AppShell
      eyebrow={formattedId}
      isOnline={isOnline}
      subtitle="Curated Atmosphere"
      title={room?.name ?? formattedId}
      usingCache={usingCache}
    >
      <div className="flex-1 flex flex-col gap-4 pb-4">
        <section className="relative h-48 w-full rounded-xl overflow-hidden mb-2 group shrink-0 shadow-[0_15px_30px_rgba(0,0,0,0.4)]">
            <img className="w-full h-full object-cover" alt={room?.name ?? formattedId} src="https://lh3.googleusercontent.com/aida-public/AB6AXuBTxv_stEar4kSpG-rUWxWBaWoCQwICBRG5ccs0ZYO7UhDKLUqZf-FhMV29n-ryiv6UdBzS6GuKV91EMzuL_hYc7-L2mO_3yZoDsSjH886eDtxTCfWLlGS6BCr23tksBLQe52Z-XgevSkXKivX3bD5Rr_Ye_8erxizEGT12YDNekBTNZEC1GyHKol0E594oOrxmc-XqcQ8teo_oyC8Z2m_ghBFlNp7pOK40Xa6ycUFXsnv-T_yb85BiA3Itr2MfHCru_NGItTTQVIg"/>
            <div className="absolute inset-0 bg-gradient-to-t from-background via-[transparent_60%] to-[transparent]"></div>
            <Link href="/" className="absolute top-4 left-4 p-2 bg-surface/60 backdrop-blur-md rounded-full active:scale-90 transition-transform">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5 text-neutral-100">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
              <div>
                <h2 className="font-headline text-2xl font-extrabold text-white leading-tight">{room?.name ?? formattedId}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`w-2 h-2 rounded-full ${isFetching ? "bg-secondary-container animate-pulse" : "bg-primary-container"}`} />
                  <span className="font-label text-xs text-on-surface-variant font-medium uppercase tracking-widest">{isFetching ? "Syncing" : "Active"}</span>
                </div>
              </div>
              <div className="bg-primary-container text-on-primary-container px-3 py-1 rounded-full font-bold text-[10px] tracking-widest uppercase">
                {activeCount} Active
              </div>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3">
             <button
                className="flex-1 rounded-lg bg-surface-container-high px-4 py-3 text-[10px] uppercase tracking-widest font-bold text-on-surface transition active:scale-95 disabled:opacity-50"
                disabled={!isOnline || pendingIds.length > 0}
                onClick={() => toggleAll("ON")}
             >All ON</button>
             <button
                className="flex-1 rounded-lg border border-outline-variant/10 bg-surface-container-low px-4 py-3 text-[10px] uppercase tracking-widest font-bold text-on-surface-variant transition active:scale-95 disabled:opacity-50"
                disabled={!isOnline || pendingIds.length > 0}
                onClick={() => toggleAll("OFF")}
             >All OFF</button>
           </div>
           
           {error && (
             <section className="rounded-lg border border-error/20 bg-error/10 p-4 text-xs font-semibold text-error">
               {error.message}
             </section>
           )}

           <div className="grid grid-cols-2 gap-4">
             {sortedDevices.map((device) => (
               <DeviceCard
                 key={device.deviceId}
                 busy={pendingIds.includes(device.deviceId)}
                 device={device}
                 disabled={!isOnline}
                 onToggle={(currentDevice) =>
                   handleDeviceAction(
                     currentDevice.deviceId,
                     currentDevice.state === "ON" ? "OFF" : "ON",
                   )
                 }
               />
             ))}
           </div>
        </section>
      </div>
    </AppShell>
  );
}
