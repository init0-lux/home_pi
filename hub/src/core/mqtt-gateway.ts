import * as mqtt from "mqtt";

type QoS = 0 | 1 | 2;
import { config } from "../config/index.js";
import { createLogger } from "../system/logger.js";
import {
  eventBus,
  EventTypes,
  DeviceStateChangedPayload,
  DeviceHeartbeatPayload,
} from "./event-bus.js";

const log = createLogger("mqtt-gateway");

// ─── Topic Patterns ───────────────────────────────────────────────────────────

/**
 * Topic structure:
 *   home/{room}/{device}/set       - hub sends commands to device
 *   home/{room}/{device}/state     - device reports its state
 *   home/{device}/heartbeat        - device liveness signal
 *   home/discovery                 - device announces itself on boot
 */

const TOPICS = {
  STATE: "home/+/+/state",
  HEARTBEAT: "home/+/heartbeat",
  DISCOVERY: "home/discovery",
} as const;

// ─── Payload Shapes (from ESP devices) ───────────────────────────────────────

interface DeviceStateMessage {
  deviceId: string;
  channel: number;
  state: "ON" | "OFF";
  timestamp?: number;
}

interface DeviceHeartbeatMessage {
  deviceId: string;
  online: boolean;
  ip?: string;
  firmware?: string;
  timestamp?: number;
}

interface DeviceDiscoveryMessage {
  deviceId: string;
  type?: string;
  room?: string;
  ip?: string;
  firmware?: string;
  timestamp?: number;
}

// ─── MQTT Gateway ────────────────────────────────────────────────────────────

class MqttGateway {
  private client: mqtt.MqttClient | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_DELAY_MS = 30_000;

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  connect(): void {
    if (this.client) {
      log.warn("MQTT gateway already connected");
      return;
    }

    const { brokerUrl, username, password, clientId, qos } = config.mqtt;

    log.info({ brokerUrl, clientId }, "Connecting to MQTT broker");

    const connectOptions: mqtt.IClientOptions = {
      clientId,
      clean: false, // persist session so we don't miss messages on reconnect
      reconnectPeriod: 1_000,
      connectTimeout: 10_000,
      keepalive: 30,
      will: {
        // Hub last-will: notify devices the hub went offline
        topic: "home/hub/status",
        payload: JSON.stringify({ online: false, timestamp: Date.now() }),
        qos: qos as QoS,
        retain: true,
      },
    };

    if (username) {
      connectOptions.username = username;
      connectOptions.password = password;
    }

    this.client = mqtt.connect(brokerUrl, connectOptions);

    this.client.on("connect", () => this.onConnect());
    this.client.on("reconnect", () => this.onReconnect());
    this.client.on("disconnect", () => this.onDisconnect());
    this.client.on("offline", () => this.onOffline());
    this.client.on("error", (err) => this.onError(err));
    this.client.on("message", (topic, payload) =>
      this.onMessage(topic, payload),
    );
  }

  disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.client) {
        resolve();
        return;
      }

      // Publish hub offline status before disconnecting
      this.publishHubStatus(false);

      this.client.end(false, {}, () => {
        log.info("MQTT gateway disconnected");
        this.client = null;
        resolve();
      });
    });
  }

  get isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  // ── Publish Helpers ─────────────────────────────────────────────────────────

  /**
   * Send a relay command to a specific device channel.
   *
   * Topic: home/{roomId}/{deviceId}/set
   * Payload: { state: 'ON' | 'OFF', channel: number }
   */
  publishCommand(
    roomId: string,
    deviceId: string,
    channel: number,
    state: "ON" | "OFF",
  ): boolean {
    const topic = `home/${roomId}/${deviceId}/set`;
    const payload = JSON.stringify({ state, channel, timestamp: Date.now() });

    return this.publish(topic, payload, {
      qos: config.mqtt.qos as QoS,
      retain: false,
    });
  }

  /**
   * Trigger OTA update on a device.
   *
   * Topic: home/{deviceId}/ota
   * Payload: { url: string, version: string }
   */
  publishOtaTrigger(
    deviceId: string,
    firmwareUrl: string,
    version: string,
  ): boolean {
    const topic = `home/${deviceId}/ota`;
    const payload = JSON.stringify({
      url: firmwareUrl,
      version,
      timestamp: Date.now(),
    });

    return this.publish(topic, payload, { qos: 1, retain: false });
  }

  /**
   * Broadcast hub online status.
   */
  publishHubStatus(online: boolean): boolean {
    const topic = "home/hub/status";
    const payload = JSON.stringify({ online, timestamp: Date.now() });

    return this.publish(topic, payload, { qos: 1, retain: true });
  }

  /**
   * Generic publish with error handling.
   */
  publish(
    topic: string,
    payload: string,
    opts: mqtt.IClientPublishOptions = {},
  ): boolean {
    if (!this.client || !this.client.connected) {
      log.warn({ topic }, "Cannot publish: MQTT client not connected");
      return false;
    }

    const defaultOpts: mqtt.IClientPublishOptions = {
      qos: config.mqtt.qos as QoS,
      retain: false,
      ...opts,
    };

    this.client.publish(topic, payload, defaultOpts, (err) => {
      if (err) {
        log.error({ err, topic }, "MQTT publish failed");
      } else {
        log.debug({ topic, payload }, "MQTT message published");
      }
    });

    return true;
  }

  // ── Connection Event Handlers ───────────────────────────────────────────────

  private onConnect(): void {
    this.reconnectAttempts = 0;
    log.info({ brokerUrl: config.mqtt.brokerUrl }, "MQTT broker connected");

    // Subscribe to all device topics
    const topicList = [TOPICS.STATE, TOPICS.HEARTBEAT, TOPICS.DISCOVERY];
    const subscribeOpts = { qos: config.mqtt.qos as QoS };

    this.client!.subscribe(topicList, subscribeOpts, (err, granted) => {
      if (err) {
        log.error({ err }, "MQTT subscription failed");
        return;
      }
      for (const grant of granted ?? []) {
        log.info({ topic: grant.topic, qos: grant.qos }, "Subscribed to topic");
      }
    });

    // Announce hub is online
    this.publishHubStatus(true);

    eventBus.emit(EventTypes.MQTT_CONNECTED, {
      brokerUrl: config.mqtt.brokerUrl,
      timestamp: Date.now(),
    });
  }

  private onReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(
      1000 * 2 ** this.reconnectAttempts,
      this.MAX_RECONNECT_DELAY_MS,
    );
    log.warn(
      { attempt: this.reconnectAttempts, nextDelayMs: delay },
      "MQTT reconnecting",
    );
  }

  private onDisconnect(): void {
    log.warn("MQTT broker disconnected");
    eventBus.emit(EventTypes.MQTT_DISCONNECTED, {
      reason: "broker disconnected",
      timestamp: Date.now(),
    });
  }

  private onOffline(): void {
    log.warn("MQTT client went offline");
    eventBus.emit(EventTypes.MQTT_DISCONNECTED, {
      reason: "client offline",
      timestamp: Date.now(),
    });
  }

  private onError(err: Error): void {
    log.error({ err }, "MQTT client error");
  }

  // ── Message Router ─────────────────────────────────────────────────────────

  private onMessage(topic: string, rawPayload: Buffer): void {
    const message = rawPayload.toString("utf-8");

    log.debug({ topic, message }, "MQTT message received");

    eventBus.emit(EventTypes.MQTT_MESSAGE, {
      topic,
      message,
      timestamp: Date.now(),
    });

    try {
      if (this.matchesTopic(topic, TOPICS.STATE)) {
        this.handleStateMessage(topic, message);
      } else if (this.matchesTopic(topic, TOPICS.HEARTBEAT)) {
        this.handleHeartbeatMessage(topic, message);
      } else if (topic === TOPICS.DISCOVERY) {
        this.handleDiscoveryMessage(message);
      } else {
        log.debug({ topic }, "Unhandled MQTT topic");
      }
    } catch (err) {
      log.error({ err, topic, message }, "Error processing MQTT message");
    }
  }

  // ── Message Handlers ───────────────────────────────────────────────────────

  /**
   * Handles: home/{room}/{device}/state
   * Emits:   DEVICE_STATE_CHANGED
   */
  private handleStateMessage(topic: string, raw: string): void {
    const parts = topic.split("/");
    // parts: [ 'home', roomId, deviceId, 'state' ]
    if (parts.length !== 4) {
      log.warn({ topic }, "Malformed state topic");
      return;
    }

    const [, , deviceId] = parts;

    let msg: DeviceStateMessage;
    try {
      msg = JSON.parse(raw) as DeviceStateMessage;
    } catch {
      log.warn({ topic, raw }, "Invalid JSON in state message");
      return;
    }

    if (!isValidState(msg.state)) {
      log.warn({ topic, state: msg.state }, "Invalid state value in message");
      return;
    }

    const payload: DeviceStateChangedPayload = {
      deviceId: msg.deviceId ?? deviceId,
      channel: msg.channel ?? 0,
      state: msg.state,
      source: "mqtt",
      timestamp: msg.timestamp ?? Date.now(),
    };

    log.info(
      {
        deviceId: payload.deviceId,
        channel: payload.channel,
        state: payload.state,
      },
      "Device state received",
    );

    eventBus.emit(EventTypes.DEVICE_STATE_CHANGED, payload);
  }

  /**
   * Handles: home/{device}/heartbeat
   * Emits:   DEVICE_HEARTBEAT
   */
  private handleHeartbeatMessage(topic: string, raw: string): void {
    const parts = topic.split("/");
    // parts: [ 'home', deviceId, 'heartbeat' ]
    if (parts.length !== 3) {
      log.warn({ topic }, "Malformed heartbeat topic");
      return;
    }

    const [, deviceId] = parts;

    let msg: DeviceHeartbeatMessage;
    try {
      msg = JSON.parse(raw) as DeviceHeartbeatMessage;
    } catch {
      log.warn({ topic, raw }, "Invalid JSON in heartbeat message");
      return;
    }

    const payload: DeviceHeartbeatPayload = {
      deviceId: msg.deviceId ?? deviceId,
      ipAddress: msg.ip,
      firmwareVersion: msg.firmware,
      timestamp: msg.timestamp ?? Date.now(),
    };

    log.debug({ deviceId: payload.deviceId }, "Heartbeat received");

    eventBus.emit(EventTypes.DEVICE_HEARTBEAT, payload);
  }

  /**
   * Handles: home/discovery
   * Emits:   DEVICE_REGISTERED (new) or DEVICE_UPDATED (known)
   */
  private handleDiscoveryMessage(raw: string): void {
    let msg: DeviceDiscoveryMessage;
    try {
      msg = JSON.parse(raw) as DeviceDiscoveryMessage;
    } catch {
      log.warn({ raw }, "Invalid JSON in discovery message");
      return;
    }

    if (!msg.deviceId) {
      log.warn({ raw }, "Discovery message missing deviceId");
      return;
    }

    log.info(
      { deviceId: msg.deviceId, room: msg.room, type: msg.type },
      "Device discovery received",
    );

    eventBus.emit(EventTypes.DEVICE_REGISTERED, {
      deviceId: msg.deviceId,
      roomId: msg.room,
      type: msg.type ?? "relay",
      ipAddress: msg.ip,
      timestamp: msg.timestamp ?? Date.now(),
    });
  }

  // ── Topic Matching ─────────────────────────────────────────────────────────

  /**
   * Match an actual topic against an MQTT wildcard pattern.
   * Supports + (single level) and # (multi level).
   */
  private matchesTopic(topic: string, pattern: string): boolean {
    const topicParts = topic.split("/");
    const patternParts = pattern.split("/");

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === "#") return true;
      if (patternParts[i] === "+") continue;
      if (patternParts[i] !== topicParts[i]) return false;
    }

    return topicParts.length === patternParts.length;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidState(value: unknown): value is "ON" | "OFF" {
  return value === "ON" || value === "OFF";
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const mqttGateway = new MqttGateway();
