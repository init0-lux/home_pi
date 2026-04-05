export const CONTRACT_VERSION = "1.0";

export type DeviceType = "light" | "fan" | "ac";
export type DeviceState = "ON" | "OFF";
export type DeviceCapability = "on" | "off";
export type DeviceStatus = "ONLINE" | "OFFLINE";

export type Device = {
  capabilities: DeviceCapability[];
  deviceId: string;
  firmwareVersion: string;
  lastSeen: number;
  name: string;
  online: boolean;
  roomId: string;
  state: DeviceState;
  type: DeviceType;
};

export type Room = {
  devices: Device[];
  name: string;
  roomId: string;
};

export type DeviceStateEvent = {
  payload: {
    deviceId: string;
    state: DeviceState;
  };
  timestamp: number;
  type: "DEVICE_STATE_CHANGED";
};

export type ActionRequest = {
  state: DeviceState;
};

export type ProvisionRequest = {
  name: string;
  password: string;
  roomId: string;
  ssid: string;
  type: DeviceType;
};

export type ProvisionResponse = {
  device: Device;
  message: string;
  roomId: string;
};

export type ChatAction = {
  deviceId: string;
  roomId: string;
  state: DeviceState;
  type: DeviceType;
};

export type ChatResponse = {
  actions: ChatAction[];
  response: string;
  roomId: string | null;
};

export type ErrorResponse = {
  error: string;
  message: string;
};
