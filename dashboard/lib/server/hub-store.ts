import { randomUUID } from "node:crypto";

import type {
  ChatAction,
  ChatResponse,
  Device,
  DeviceState,
  DeviceType,
  ErrorResponse,
  ProvisionRequest,
  Room,
} from "@/lib/contracts";

type HubStore = {
  devices: Device[];
  rooms: Array<Pick<Room, "name" | "roomId">>;
};

const globalStore = globalThis as typeof globalThis & {
  __zappHubStore?: HubStore;
};

function epochNow() {
  return Math.floor(Date.now() / 1000);
}

function seedStore(): HubStore {
  const rooms = [
    { name: "Room 101", roomId: "room-101" },
    { name: "Room 102", roomId: "room-102" },
    { name: "Room 201", roomId: "room-201" },
  ];

  return {
    devices: [
      {
        capabilities: ["on", "off"],
        deviceId: "f42483d9-2ec0-4e16-9e04-8d5841140101",
        firmwareVersion: "1.0.0",
        lastSeen: epochNow() - 12,
        name: "Entry Light",
        online: true,
        roomId: "room-101",
        state: "ON",
        type: "light",
      },
      {
        capabilities: ["on", "off"],
        deviceId: "f42483d9-2ec0-4e16-9e04-8d5841140102",
        firmwareVersion: "1.0.0",
        lastSeen: epochNow() - 18,
        name: "Ceiling Fan",
        online: true,
        roomId: "room-101",
        state: "OFF",
        type: "fan",
      },
      {
        capabilities: ["on", "off"],
        deviceId: "f42483d9-2ec0-4e16-9e04-8d5841140103",
        firmwareVersion: "1.0.0",
        lastSeen: epochNow() - 23,
        name: "AC",
        online: true,
        roomId: "room-101",
        state: "OFF",
        type: "ac",
      },
      {
        capabilities: ["on", "off"],
        deviceId: "d1049357-e7ad-4a83-a0dd-068f9c0a0201",
        firmwareVersion: "1.0.0",
        lastSeen: epochNow() - 21,
        name: "Bedside Light",
        online: true,
        roomId: "room-102",
        state: "OFF",
        type: "light",
      },
      {
        capabilities: ["on", "off"],
        deviceId: "d1049357-e7ad-4a83-a0dd-068f9c0a0202",
        firmwareVersion: "1.0.0",
        lastSeen: epochNow() - 130,
        name: "Fan",
        online: false,
        roomId: "room-102",
        state: "OFF",
        type: "fan",
      },
      {
        capabilities: ["on", "off"],
        deviceId: "cf5f32ff-51f0-43e7-810b-cd7963d80301",
        firmwareVersion: "1.0.0",
        lastSeen: epochNow() - 8,
        name: "Ambient Light",
        online: true,
        roomId: "room-201",
        state: "ON",
        type: "light",
      },
      {
        capabilities: ["on", "off"],
        deviceId: "cf5f32ff-51f0-43e7-810b-cd7963d80302",
        firmwareVersion: "1.0.0",
        lastSeen: epochNow() - 8,
        name: "Climate Control",
        online: true,
        roomId: "room-201",
        state: "ON",
        type: "ac",
      },
    ],
    rooms,
  };
}

function getStore() {
  if (!globalStore.__zappHubStore) {
    globalStore.__zappHubStore = seedStore();
  }

  return globalStore.__zappHubStore;
}

export class ContractError extends Error {
  readonly payload: ErrorResponse;
  readonly status: number;

  constructor(status: number, payload: ErrorResponse) {
    super(payload.message);
    this.status = status;
    this.payload = payload;
  }
}

export function listDevices() {
  return getStore().devices.toSorted((left, right) =>
    left.roomId.localeCompare(right.roomId),
  );
}

export function listRooms() {
  const store = getStore();

  return store.rooms
    .map((room) => ({
      ...room,
      devices: store.devices.filter((device) => device.roomId === room.roomId),
    }))
    .toSorted((left, right) => left.roomId.localeCompare(right.roomId));
}

export function getRoom(roomId: string) {
  const room = listRooms().find((item) => item.roomId === roomId);

  if (!room) {
    throw new ContractError(404, {
      error: "ROOM_NOT_FOUND",
      message: "Room does not exist",
    });
  }

  return room;
}

export function setDeviceAction(deviceId: string, state: DeviceState) {
  const store = getStore();
  const device = store.devices.find((item) => item.deviceId === deviceId);

  if (!device) {
    throw new ContractError(404, {
      error: "DEVICE_NOT_FOUND",
      message: "Device does not exist",
    });
  }

  device.state = state;
  device.online = true;
  device.lastSeen = epochNow();

  return device;
}

export function registerDevice(payload: ProvisionRequest) {
  const store = getStore();
  const room = store.rooms.find((item) => item.roomId === payload.roomId);

  if (!room) {
    throw new ContractError(404, {
      error: "ROOM_NOT_FOUND",
      message: "Room does not exist",
    });
  }

  const device: Device = {
    capabilities: ["on", "off"],
    deviceId: randomUUID(),
    firmwareVersion: "1.0.0",
    lastSeen: epochNow(),
    name: payload.name,
    online: true,
    roomId: payload.roomId,
    state: "OFF",
    type: payload.type,
  };

  store.devices.unshift(device);

  return {
    device,
    message: `${device.name} joined ${room.name} and is ready for local control.`,
    roomId: room.roomId,
  };
}

function extractState(query: string): DeviceState | null {
  if (/(turn|switch|set).*(off)|\boff\b|disable|shutdown/i.test(query)) {
    return "OFF";
  }

  if (/(turn|switch|set).*(on)|\bon\b|enable|start/i.test(query)) {
    return "ON";
  }

  return null;
}

function extractRoomId(query: string) {
  const match = query.match(/room[\s-]?(\d{3})/i);
  return match ? `room-${match[1]}` : null;
}

function extractType(query: string): DeviceType | null {
  if (/light/i.test(query)) {
    return "light";
  }

  if (/fan/i.test(query)) {
    return "fan";
  }

  if (/\bac\b|air/i.test(query)) {
    return "ac";
  }

  return null;
}

export function queryAssistant(query: string): ChatResponse {
  const desiredState = extractState(query);

  if (!desiredState) {
    return {
      actions: [],
      response:
        "I can toggle lights, fans, and AC devices. Try 'Turn off all lights in Room 101'.",
      roomId: null,
    };
  }

  const requestedRoomId = extractRoomId(query);
  const requestedType = extractType(query);
  const wantsAll = /\ball\b|\bevery\b/i.test(query);

  let devices = listDevices();

  if (requestedRoomId) {
    devices = devices.filter((device) => device.roomId === requestedRoomId);
  }

  if (requestedType) {
    devices = devices.filter((device) => device.type === requestedType);
  }

  if (!wantsAll && devices.length > 1) {
    devices = [devices[0]];
  }

  if (devices.length === 0) {
    return {
      actions: [],
      response:
        "I couldn't find a matching device. Check the room number or try a more specific command.",
      roomId: requestedRoomId,
    };
  }

  const actions: ChatAction[] = devices.map((device) => {
    const updated = setDeviceAction(device.deviceId, desiredState);

    return {
      deviceId: updated.deviceId,
      roomId: updated.roomId,
      state: updated.state,
      type: updated.type,
    };
  });

  const scope = requestedRoomId ? requestedRoomId.replace("room-", "Room ") : "the property";
  const detail = wantsAll ? `${actions.length} devices` : devices[0].name;

  return {
    actions,
    response: `Set ${detail} in ${scope} to ${desiredState}.`,
    roomId: actions[0]?.roomId ?? requestedRoomId,
  };
}
