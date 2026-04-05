"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { setDeviceState } from "@/lib/api";
import type { Device, DeviceState, Room } from "@/lib/contracts";
import { queryKeys } from "@/lib/query-keys";
import { useDashboardStore } from "@/lib/store/dashboard-store";
import { applyDeviceToRoom, applyDeviceToRooms } from "@/lib/utils";

type Variables = {
  deviceId: string;
  roomId: string;
  state: DeviceState;
};

type MutationContext = {
  previousRoom?: Room;
  previousRooms?: Room[];
};

export function useSetDeviceState() {
  const queryClient = useQueryClient();
  const updateCachedDevice = useDashboardStore((store) => store.updateCachedDevice);

  return useMutation<Device, Error, Variables, MutationContext>({
    mutationFn: async ({ deviceId, state }: Variables) =>
      setDeviceState(deviceId, { state }),
    onError: (_error, variables, context) => {
      if (context?.previousRooms) {
        queryClient.setQueryData(queryKeys.rooms, context.previousRooms);
      }

      if (context?.previousRoom) {
        queryClient.setQueryData(queryKeys.room(variables.roomId), context.previousRoom);
      }
    },
    onMutate: async (variables) => {
      const optimisticTimestamp = Math.floor(Date.now() / 1000);

      await Promise.all([
        queryClient.cancelQueries({ queryKey: queryKeys.rooms }),
        queryClient.cancelQueries({ queryKey: queryKeys.room(variables.roomId) }),
      ]);

      const previousRooms = queryClient.getQueryData<Room[]>(queryKeys.rooms);
      const previousRoom = queryClient.getQueryData<Room>(
        queryKeys.room(variables.roomId),
      );

      queryClient.setQueryData<Room[] | undefined>(
        queryKeys.rooms,
        (rooms) =>
          applyDeviceToRooms(
            rooms,
            variables.deviceId,
            variables.state,
            optimisticTimestamp,
          ),
      );
      queryClient.setQueryData<Room | undefined>(
        queryKeys.room(variables.roomId),
        (room) =>
          applyDeviceToRoom(
            room,
            variables.deviceId,
            variables.state,
            optimisticTimestamp,
          ),
      );
      updateCachedDevice(
        variables.deviceId,
        variables.state,
        optimisticTimestamp,
        true,
      );

      return {
        previousRoom,
        previousRooms,
      };
    },
    onSuccess: (device) => {
      queryClient.setQueryData<Room[] | undefined>(queryKeys.rooms, (rooms) =>
        applyDeviceToRooms(rooms, device.deviceId, device.state, device.lastSeen, device.online),
      );
      queryClient.setQueryData<Room | undefined>(
        queryKeys.room(device.roomId),
        (room) =>
          applyDeviceToRoom(room, device.deviceId, device.state, device.lastSeen, device.online),
      );
      updateCachedDevice(device.deviceId, device.state, device.lastSeen, device.online);
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.rooms });
      queryClient.invalidateQueries({ queryKey: queryKeys.room(variables.roomId) });
    },
  });
}
