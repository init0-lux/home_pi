"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { DeviceState, Room } from "@/lib/contracts";
import { applyDeviceToRooms } from "@/lib/utils";

type DashboardStore = {
  cachedRooms: Room[];
  connectionOnline: boolean;
  hydrateRooms: (rooms: Room[]) => void;
  lastSyncAt: number | null;
  setConnectionOnline: (online: boolean) => void;
  setLastSyncAt: (timestamp: number) => void;
  updateCachedDevice: (
    deviceId: string,
    state: DeviceState,
    lastSeen: number,
    online?: boolean,
  ) => void;
  upsertRoom: (room: Room) => void;
};

export const useDashboardStore = create<DashboardStore>()(
  persist(
    (set) => ({
      cachedRooms: [],
      connectionOnline: true,
      hydrateRooms: (rooms) =>
        set({
          cachedRooms: rooms,
        }),
      lastSyncAt: null,
      setConnectionOnline: (online) =>
        set({
          connectionOnline: online,
        }),
      setLastSyncAt: (timestamp) =>
        set({
          lastSyncAt: timestamp,
        }),
      updateCachedDevice: (deviceId, state, lastSeen, online = true) =>
        set((store) => ({
          cachedRooms:
            applyDeviceToRooms(
              store.cachedRooms,
              deviceId,
              state,
              lastSeen,
              online,
            ) ?? [],
        })),
      upsertRoom: (room) =>
        set((store) => {
          const existing = store.cachedRooms.some(
            (item) => item.roomId === room.roomId,
          );

          return {
            cachedRooms: existing
              ? store.cachedRooms.map((item) =>
                  item.roomId === room.roomId ? room : item,
                )
              : [...store.cachedRooms, room].toSorted((left, right) =>
                  left.roomId.localeCompare(right.roomId),
                ),
          };
        }),
    }),
    {
      name: "zapp-dashboard-cache",
      partialize: (state) => ({
        cachedRooms: state.cachedRooms,
        lastSyncAt: state.lastSyncAt,
      }),
    },
  ),
);
