import * as mqtt from "mqtt";
import { config } from "../config/index.js";
import { createLogger } from "../system/logger.js";
import {
  eventBus,
  EventTypes,
  DeviceStateChangedPayload,
  DeviceHeartbeatPayload,
} from "./event-bus.js";

const log = createLogger("mqtt-gateway");

type QoS = 0 | 1 | 2;

// ─── Topic Patterns ───────────────────────────────────────────────────────────
//
// home/{room}/{device}/state  — device reports state
// home/{device}/heartbeat     — device liveness
// home/discovery              — device announces itself on boot
// home/{room}/{device}/set    — hub sends command  [publish only]
// home/hub/status             — hub liveness LWT   [publish only]

const TOPICS = {
  STATE:     "home/+/+/state",
  HEARTBEAT: "home/+/heartbeat",
  DISCOVERY: "home/discovery",
} as const;

// ─── Device Message Shapes ────────────────────────────────────────────────────

interface StateMessage {
  deviceId?: string;
  channel?: number;
  state: "ON" | "OFF";
  timestamp?: number;
}

interface HeartbeatMessage {
  deviceId?: string;
  online?: boolean;
  ip?: string;
  firmware?: string;
  timestamp?: number;
}

interface DiscoveryMessage {
  deviceId: string;
  type?: string;
  room?: string;
  ip?: string;
  firmware?: string;
  timestamp?: number;
}

// ─── MQTT Gateway ─────────────────────────────────────────────────────────────

class MqttGateway {
  private client: mqtt.MqttClient | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_DELAY_MS = 30_000;

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  connect(): void {
    if (this.client) {
      log.warn("MQTT gateway already connected");
      return;
    }

    const { brokerUrl, username, password, clientId, qos } = config.mqtt;

    log.info({ brokerUrl, clientId }, "Connecting to MQTT broker");

    const opts: mqtt.IClientOptions = {
      clientId,
      clean: false,
      reconnectPeriod: 1_000,
      connectTimeout: 10_000,
      keepalive: 30,
      will: {
        topic: "home/hub/status",
        payload: JSON.stringify({ online: false, timestamp: Date.now() }),
        qos: qos as QoS,
        retain: true,
      },
    };

    if (username) {
      opts.username = username;
      opts.password = password;
    }

    this.client = mqtt.connect(brokerUrl, opts);

    this.client.on("connect",     () => this.onConnect());
    this.client.on("reconnect",   () => this.onReconnect());
    this.client.on("disconnect",  () => this.onDisconnect());
    this.client.on("offline",     () => this.onOffline());
    this.client.on("error",  (err) => this.onError(err));
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

  // ── Publish Helpers ──────────────────────────────────────────────────────────

  /**
   * Send a relay command to a specific device channel.
   * Topic: home/{roomId}/{deviceId}/set
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
   * Trigger an OTA update on a device.
   * Topic: home/{deviceId}/ota
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
   * Broadcast hub online/offline status (retained).
   * Topic: home/hub/status
   */
  publishHubStatus(online: boolean): boolean {
    return this.publish(
      "home/hub/status",
      JSON.stringify({ online, timestamp: Date.now() }),
      { qos: 1, retain: true },
    );
  }

  publish(
    topic: string,
    payload: string,
    opts: mqtt.IClientPublishOptions = {},
  ): boolean {
    if (!this.client?.connected) {
      log.warn({ topic }, "Cannot publish: MQTT client not connected");
      return false;
    }

    const finalOpts: mqtt.IClientPublishOptions = {
      qos: config.mqtt.qos as QoS,
      retain: false,
      ...opts,
    };

    this.client.publish(topic, payload, finalOpts, (err) => {
      if (err) {
        log.error({ err, topic }, "MQTT publish failed");
      } else {
        log.debug({ topic }, "MQTT message published");
      }
    });

    return true;
  }

  // ── Connection Handlers ───────────────────────────────────────────────────────

  private onConnect(): void {
    this.reconnectAttempts = 0;
    log.info({ brokerUrl: config.mqtt.brokerUrl }, "MQTT broker connected");

    const topicList = [TOPICS.STATE, TOPICS.HEARTBEAT, TOPICS.DISCOVERY];
    const subOpts = { qos: config.mqtt.qos as QoS };

    this.client!.subscribe(topicList, subOpts, (err, granted) => {
      if (err) {
        log.error({ err }, "MQTT subscription failed");
        return;
      }
      for (const grant of granted ?? []) {
        log.info({ topic: grant.topic, qos: grant.qos }, "Subscribed");
      }
    });

    this.publishHubStatus(true);

    eventBus.emit(EventTypes.MQTT_CONNECTED, {
      brokerUrl: config.mqtt.brokerUrl,
      timestamp: Date.now(),
    });
  }

  private onReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(
      1_000 * 2 ** this.reconnectAttempts,
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
    log.warn("MQTT client offline");
    eventBus.emit(EventTypes.MQTT_DISCONNECTED, {
      reason: "client offline",
      timestamp: Date.now(),
    });
  }

  private onError(err: Error): void {
    log.error({ err }, "MQTT client error");
  }

  // ── Message Router ────────────────────────────────────────────────────────────

  private onMessage(topic: string, rawPayload: Buffer): void {
    const message = rawPayload.toString("utf-8");

    log.debug({ topic }, "MQTT message received");

    eventBus.emit(EventTypes.MQTT_MESSAGE, {
      topic,
      message,
      timestamp: Date.now(),
    });

    try {
      if (this.matches(topic, TOPICS.STATE)) {
        this.handleState(topic, message);
      } else if (this.matches(topic, TOPICS.HEARTBEAT)) {
        this.handleHeartbeat(topic, message);
      } else if (topic === TOPICS.DISCOVERY) {
        this.handleDiscovery(message);
      } else {
        log.debug({ topic }, "Unhandled MQTT topic");
      }
    } catch (err) {
      log.error({ err, topic }, "Error processing MQTT message");
    }
  }

  // ── Message Handlers ──────────────────────────────────────────────────────────

  /** home/{room}/{device}/state */
  private handleState(topic: string, raw: string): void {
    const parts = topic.split("/");
    // [ "home", roomId, deviceId, "state" ]
    if (parts.length !== 4) {
      log.warn({ topic }, "Malformed state topic");
      return;
    }

    const deviceId = parts[2]!;

    let msg: StateMessage;
    try {
      msg = JSON.parse(raw) as StateMessage;
    } catch {
      log.warn({ topic, raw }, "Invalid JSON in state message");
      return;
    }

    if (msg.state !== "ON" && msg.state !== "OFF") {
      log.warn({ topic, state: msg.state }, "Invalid state value");
      return;
    }

    const payload: DeviceStateChangedPayload = {
      deviceId: msg.deviceId ?? deviceId,
      channel:  msg.channel  ?? 0,
      state:    msg.state,
      source:   "mqtt",
      timestamp: msg.timestamp ?? Date.now(),
    };

    log.info(
      { deviceId: payload.deviceId, channel: payload.channel, state: payload.state },
      "Device state received",
    );

    eventBus.emit(EventTypes.DEVICE_STATE_CHANGED, payload);
  }

  /** home/{device}/heartbeat */
  private handleHeartbeat(topic: string, raw: string): void {
    const parts = topic.split("/");
    // [ "home", deviceId, "heartbeat" ]
    if (parts.length !== 3) {
      log.warn({ topic }, "Malformed heartbeat topic");
      return;
    }

    const deviceId = parts[1]!;

    let msg: HeartbeatMessage;
    try {
      msg = JSON.parse(raw) as HeartbeatMessage;
    } catch {
      log.warn({ topic, raw }, "Invalid JSON in heartbeat");
      return;
    }

    const payload: DeviceHeartbeatPayload = {
      deviceId:        msg.deviceId ?? deviceId,
      ipAddress:       msg.ip,
      firmwareVersion: msg.firmware,
      timestamp:       msg.timestamp ?? Date.now(),
    };

    log.debug({ deviceId: payload.deviceId }, "Heartbeat received");

    eventBus.emit(EventTypes.DEVICE_HEARTBEAT, payload);
  }

  /** home/discovery */
  private handleDiscovery(raw: string): void {
    let msg: DiscoveryMessage;
    try {
      msg = JSON.parse(raw) as DiscoveryMessage;
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
      deviceId:  msg.deviceId,
      roomId:    msg.room,
      type:      msg.type ?? "relay",
      ipAddress: msg.ip,
      timestamp: msg.timestamp ?? Date.now(),
    });
  }

  // ── Topic Matching ────────────────────────────────────────────────────────────

  /** Match an actual topic against an MQTT wildcard pattern (+, #). */
  private matches(topic: string, pattern: string): boolean {
    const t = topic.split("/");
    const p = pattern.split("/");

    for (let i = 0; i < p.length; i++) {
      if (p[i] === "#") return true;
      if (p[i] === "+") continue;
      if (p[i] !== t[i]) return false;
    }

    return t.length === p.length;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const mqttGateway = new MqttGateway();
