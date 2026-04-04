"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { getRoom } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useDashboardStore } from "@/lib/store/dashboard-store";

import { useConnectionStatus } from "./use-connection-status";

export function useRoomData(roomId: string) {
  const cachedRoom = useDashboardStore((store) =>
    store.cachedRooms.find((room) => room.roomId === roomId),
  );
  const setLastSyncAt = useDashboardStore((store) => store.setLastSyncAt);
  const upsertRoom = useDashboardStore((store) => store.upsertRoom);
  const isOnline = useConnectionStatus();

  const query = useQuery({
    enabled: Boolean(roomId),
    queryFn: () => getRoom(roomId),
    queryKey: queryKeys.room(roomId),
    refetchInterval: isOnline ? 2500 : false,
    retry: 1,
    staleTime: 1000,
  });

  useEffect(() => {
    if (!query.data) {
      return;
    }

    upsertRoom(query.data);
    setLastSyncAt(Date.now());
  }, [query.data, setLastSyncAt, upsertRoom]);

  return {
    ...query,
    isOnline,
    room: query.data ?? cachedRoom,
    usingCache: !query.data && Boolean(cachedRoom),
  };
}
