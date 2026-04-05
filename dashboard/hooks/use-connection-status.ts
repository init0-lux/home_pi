"use client";

import { useEffect, useState } from "react";

import { useDashboardStore } from "@/lib/store/dashboard-store";

export function useConnectionStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const setConnectionOnline = useDashboardStore(
    (store) => store.setConnectionOnline,
  );

  useEffect(() => {
    const syncStatus = () => {
      const online = navigator.onLine;
      setIsOnline(online);
      setConnectionOnline(online);
    };

    syncStatus();
    window.addEventListener("online", syncStatus);
    window.addEventListener("offline", syncStatus);

    return () => {
      window.removeEventListener("online", syncStatus);
      window.removeEventListener("offline", syncStatus);
    };
  }, [setConnectionOnline]);

  return isOnline;
}
