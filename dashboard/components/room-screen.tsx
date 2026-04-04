"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { DeviceCard } from "@/components/device-card";
import { useRoomData } from "@/hooks/use-room-data";
import { useSetDeviceState } from "@/hooks/use-set-device-state";
import { queryKeys } from "@/lib/query-keys";
import { formatRoomLabel } from "@/lib/utils";

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

  return (
    <AppShell
      eyebrow="Room View"
      isOnline={isOnline}
      subtitle="Contract-aligned local control with optimistic toggles, online health, and group actions for housekeeping and guest operations."
      title={room?.name ?? formatRoomLabel(roomId)}
      usingCache={usingCache}
    >
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-[32px] border border-white/10 bg-slate-950/35 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            className="rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/8"
            href="/"
          >
            Back to property
          </Link>
          <span className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300">
            {isFetching ? "Refreshing..." : `${sortedDevices.length} devices`}
          </span>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-slate-100 disabled:opacity-60"
            disabled={!isOnline || pendingIds.length > 0}
            onClick={() => toggleAll("ON")}
            type="button"
          >
            All ON
          </button>
          <button
            className="rounded-full border border-white/10 bg-white/8 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/12 disabled:opacity-60"
            disabled={!isOnline || pendingIds.length > 0}
            onClick={() => toggleAll("OFF")}
            type="button"
          >
            All OFF
          </button>
        </div>
      </section>

      {error ? (
        <section className="rounded-[32px] border border-rose-300/20 bg-rose-300/10 p-6 text-rose-100">
          {error.message}
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
      </section>
    </AppShell>
  );
}
