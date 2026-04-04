"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { getRooms } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useDashboardStore } from "@/lib/store/dashboard-store";

import { useConnectionStatus } from "./use-connection-status";

export function useRoomsData() {
  const cachedRooms = useDashboardStore((store) => store.cachedRooms);
  const hydrateRooms = useDashboardStore((store) => store.hydrateRooms);
  const setLastSyncAt = useDashboardStore((store) => store.setLastSyncAt);
  const isOnline = useConnectionStatus();

  const query = useQuery({
    queryFn: getRooms,
    queryKey: queryKeys.rooms,
    refetchInterval: isOnline ? 2500 : false,
    retry: 1,
    staleTime: 1000,
  });

  useEffect(() => {
    if (!query.data) {
      return;
    }

    hydrateRooms(query.data);
    setLastSyncAt(Date.now());
  }, [hydrateRooms, query.data, setLastSyncAt]);

  return {
    ...query,
    isOnline,
    rooms: query.data ?? cachedRooms,
    usingCache: !query.data && cachedRooms.length > 0,
  };
}
