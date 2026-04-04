import type {
  ActionRequest,
  ChatResponse,
  Device,
  DeviceState,
  ProvisionRequest,
  ProvisionResponse,
  Room,
} from "@/lib/contracts";

async function parseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { message?: string };

  if (!response.ok) {
    const message =
      typeof body === "object" && body && "message" in body
        ? body.message
        : "Something went wrong";
    throw new Error(message);
  }

  return body;
}

export async function getRooms() {
  const response = await fetch("/api/rooms", { cache: "no-store" });
  return parseJson<Room[]>(response);
}

export async function getRoom(roomId: string) {
  const response = await fetch(`/api/rooms/${roomId}`, { cache: "no-store" });
  return parseJson<Room>(response);
}

export async function getDevices() {
  const response = await fetch("/api/devices", { cache: "no-store" });
  return parseJson<Device[]>(response);
}

export async function setDeviceState(deviceId: string, payload: ActionRequest) {
  const response = await fetch(`/api/devices/${deviceId}/action`, {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return parseJson<Device>(response);
}

export async function setRoomDevicesState(
  roomId: string,
  devices: Device[],
  state: DeviceState,
) {
  const roomDevices = devices.filter((device) => device.roomId === roomId);
  return Promise.all(
    roomDevices.map((device) => setDeviceState(device.deviceId, { state })),
  );
}

export async function provisionDevice(payload: ProvisionRequest) {
  const response = await fetch("/api/provision", {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return parseJson<ProvisionResponse>(response);
}

export async function queryMcp(query: string) {
  const response = await fetch("/api/mcp/query", {
    body: JSON.stringify({ query }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return parseJson<ChatResponse>(response);
}
