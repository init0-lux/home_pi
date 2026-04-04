import type { Device, DeviceState, Room } from "@/lib/contracts";

export function formatRoomLabel(roomId: string) {
  return roomId.replace(/^room-?/i, "Room ").replace(/-/g, " ");
}

export function formatEpochRelative(timestamp: number) {
  const deltaSeconds = timestamp - Math.floor(Date.now() / 1000);
  const absolute = Math.abs(deltaSeconds);

  if (absolute < 30) {
    return "just now";
  }

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absolute < 3600) {
    return formatter.format(Math.round(deltaSeconds / 60), "minute");
  }

  if (absolute < 86400) {
    return formatter.format(Math.round(deltaSeconds / 3600), "hour");
  }

  return formatter.format(Math.round(deltaSeconds / 86400), "day");
}

export function countOnlineDevices(devices: Device[]) {
  return devices.filter((device) => device.online).length;
}

export function countActiveDevices(devices: Device[]) {
  return devices.filter((device) => device.state === "ON").length;
}

export function applyDeviceToRoom(
  room: Room | undefined,
  deviceId: string,
  state: DeviceState,
  lastSeen: number,
  online = true,
) {
  if (!room) {
    return room;
  }

  return {
    ...room,
    devices: room.devices.map((device) =>
      device.deviceId === deviceId
        ? { ...device, lastSeen, online, state }
        : device,
    ),
  };
}

export function applyDeviceToRooms(
  rooms: Room[] | undefined,
  deviceId: string,
  state: DeviceState,
  lastSeen: number,
  online = true,
) {
  if (!rooms) {
    return rooms;
  }

  return rooms.map((room) => applyDeviceToRoom(room, deviceId, state, lastSeen, online)!);
}
