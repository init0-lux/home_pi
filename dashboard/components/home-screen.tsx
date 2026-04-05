"use client";

import { useRoomsData } from "@/hooks/use-rooms-data";
import { RoomCard } from "@/components/room-card";
import { AppShell } from "./app-shell";

export function HomeScreen() {
  const { error, isOnline, rooms, usingCache } = useRoomsData();

  return (
    <AppShell
      eyebrow="Admin"
      isOnline={isOnline}
      subtitle="Systems Status"
      title="Zapp"
      usingCache={usingCache}
    >
      <div className="flex-1 flex flex-col gap-3 pb-4">
        {error && (
           <p className="mt-2 text-sm text-error">{error.message}</p>
        )}
        
        {rooms.map((room) => (
          <RoomCard key={room.roomId} room={room} />
        ))}
        {rooms.length === 0 && !error && (
          <div className="text-center py-10">
            <p className="text-sm text-on-surface-variant font-label">No rooms connected</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
