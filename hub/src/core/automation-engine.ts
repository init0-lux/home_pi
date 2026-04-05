import { createLogger } from "../system/logger.js";
import {
  eventBus,
  EventTypes,
  ScheduleFiredPayload,
  GuestCheckinPayload,
  GuestCheckoutPayload,
  AutomationTriggeredPayload,
} from "./event-bus.js";
import { stateManager } from "./state-manager.js";
import { mqttGateway } from "./mqtt-gateway.js";
import { deviceRegistry } from "./device-registry.js";
import { getDb } from "../db/index.js";
import { v4 as uuidv4 } from "uuid";

const log = createLogger("automation-engine");

// ─── Types ────────────────────────────────────────────────────────────────────

export type TriggerType =
  | "schedule"
  | "guest_checkin"
  | "guest_checkout"
  | "device_state"
  | "manual";

export type ActionType =
  | "set_device_state"
  | "set_room_state"
  | "toggle_device";

export interface AutomationTrigger {
  type: TriggerType;
  /** For guest_checkin / guest_checkout: which room */
  roomId?: string;
  /** For device_state: which device + which state triggers this */
  deviceId?: string;
  state?: "ON" | "OFF";
}

export interface AutomationAction {
  type: ActionType;
  deviceId?: string;
  roomId?: string;
  channel?: number;
  state?: "ON" | "OFF";
  /** Delay in seconds before executing this action */
  delaySeconds?: number;
}

export interface Automation {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  enabled: boolean;
  createdAt: number;
}

export interface CreateAutomationInput {
  name: string;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
}

interface DbAutomation {
  id: string;
  name: string;
  trigger: string;
  actions: string;
  enabled: number;
  created_at: number;
}

// ─── Automation Engine ────────────────────────────────────────────────────────

class AutomationEngine {
  /** Active delayed-action timers, keyed by a unique handle string */
  private delayTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  init(): void {
    this.subscribeToEvents();
    log.info("Automation engine initialized");
  }

  destroy(): void {
    // Cancel all pending delayed actions
    for (const timer of this.delayTimers.values()) {
      clearTimeout(timer);
    }
    this.delayTimers.clear();
    log.info("Automation engine destroyed");
  }

  // ── Event Subscriptions ─────────────────────────────────────────────────────

  private subscribeToEvents(): void {
    // Scheduler fires a SCHEDULE_FIRED event → find matching automations
    eventBus.on(EventTypes.SCHEDULE_FIRED, (payload) => {
      this.handleScheduleFired(payload);
    });

    // PMS check-in → trigger room-level automations
    eventBus.on(EventTypes.GUEST_CHECKIN, (payload) => {
      this.handleGuestCheckin(payload);
    });

    // PMS check-out → turn off all devices in the room
    eventBus.on(EventTypes.GUEST_CHECKOUT, (payload) => {
      this.handleGuestCheckoutEvent(payload);
    });

    // Device state changes can themselves trigger automations (reactive rules)
    eventBus.on(EventTypes.DEVICE_STATE_CHANGED, (payload) => {
      this.handleDeviceStateChanged(payload.deviceId, payload.state);
    });
  }

  // ── Event Handlers ─────────────────────────────────────────────────────────

  /**
   * A schedule that has fired. The schedule action contains a direct
   * device/room command — execute it immediately.
   */
  private handleScheduleFired(payload: ScheduleFiredPayload): void {
    const { scheduleId, deviceId, roomId, action } = payload;

    log.info(
      { scheduleId, deviceId, roomId, action },
      "Handling fired schedule",
    );

    const automationAction = this.buildActionFromSchedulePayload(
      deviceId,
      roomId,
      action,
    );

    if (!automationAction) {
      log.warn(
        { scheduleId, action },
        "Could not build action from schedule payload",
      );
      return;
    }

    this.executeAction(automationAction, `schedule:${scheduleId}`);

    // Also look for any AUTOMATION rules with trigger type 'schedule' that
    // reference this schedule, and run those too.
    const automations = this.listAutomationsByTrigger("schedule");
    for (const automation of automations) {
      if (!automation.enabled) continue;
      this.runAutomation(automation, { schedule: scheduleId });
    }
  }

  /**
   * Guest check-in: turn on all devices in the assigned room.
   */
  private handleGuestCheckin(payload: GuestCheckinPayload): void {
    const { guestId, roomId } = payload;

    log.info({ guestId, roomId }, "Handling guest check-in automation");

    // Built-in behaviour: turn on all devices in the room
    this.executeRoomAction(roomId, "ON", "automation");

    // Find any explicit AUTOMATION rules for guest_checkin in this room
    const automations = this.listAutomationsByTrigger("guest_checkin");
    for (const automation of automations) {
      if (!automation.enabled) continue;
      if (automation.trigger.roomId && automation.trigger.roomId !== roomId)
        continue;
      this.runAutomation(automation, { guestId, roomId });
    }
  }

  /**
   * Guest check-out: turn off all devices in the room.
   */
  private handleGuestCheckoutEvent(payload: GuestCheckoutPayload): void {
    const { guestId, roomId } = payload;

    log.info({ guestId, roomId }, "Handling guest check-out automation");

    this.executeRoomAction(roomId, "OFF", "automation");

    const automations = this.listAutomationsByTrigger("guest_checkout");
    for (const automation of automations) {
      if (!automation.enabled) continue;
      if (automation.trigger.roomId && automation.trigger.roomId !== roomId)
        continue;
      this.runAutomation(automation, { guestId, roomId });
    }
  }

  /**
   * A device changed state — check for reactive automation rules.
   */
  private handleDeviceStateChanged(
    deviceId: string,
    state: "ON" | "OFF",
  ): void {
    const automations = this.listAutomationsByTrigger("device_state");

    for (const automation of automations) {
      if (!automation.enabled) continue;
      const trigger = automation.trigger;
      if (trigger.deviceId && trigger.deviceId !== deviceId) continue;
      if (trigger.state && trigger.state !== state) continue;

      log.info(
        { automationId: automation.id, deviceId, state },
        "Reactive automation triggered by device state change",
      );

      this.runAutomation(automation, { deviceId, state });
    }
  }

  // ── Automation Execution ───────────────────────────────────────────────────

  /**
   * Run all actions in an automation rule, respecting per-action delays.
   */
  private runAutomation(
    automation: Automation,
    triggerContext: Record<string, unknown>,
  ): void {
    log.info(
      { automationId: automation.id, name: automation.name, triggerContext },
      "Running automation",
    );

    const payload: AutomationTriggeredPayload = {
      automationId: automation.id,
      trigger: triggerContext,
      actions: automation.actions as unknown as Array<Record<string, unknown>>,
      timestamp: Date.now(),
    };

    eventBus.emit(EventTypes.AUTOMATION_TRIGGERED, payload);

    for (const action of automation.actions) {
      this.executeAction(action, automation.id);
    }
  }

  /**
   * Execute a single automation action, honouring optional delaySeconds.
   */
  private executeAction(action: AutomationAction, sourceId: string): void {
    const delayMs = (action.delaySeconds ?? 0) * 1000;

    if (delayMs > 0) {
      const handle = `${sourceId}:${uuidv4()}`;
      const timer = setTimeout(() => {
        this.delayTimers.delete(handle);
        this.dispatchAction(action, sourceId);
      }, delayMs);

      this.delayTimers.set(handle, timer);
      log.debug({ action, delayMs, handle }, "Action scheduled with delay");
    } else {
      this.dispatchAction(action, sourceId);
    }
  }

  /**
   * The actual dispatch: update hub state + publish MQTT command.
   */
  private dispatchAction(action: AutomationAction, sourceId: string): void {
    try {
      switch (action.type) {
        case "set_device_state": {
          if (!action.deviceId) {
            log.warn({ action, sourceId }, "set_device_state missing deviceId");
            return;
          }
          if (!action.state) {
            log.warn({ action, sourceId }, "set_device_state missing state");
            return;
          }
          this.executeDeviceAction(
            action.deviceId,
            action.channel ?? 0,
            action.state,
          );
          break;
        }

        case "set_room_state": {
          if (!action.roomId) {
            log.warn({ action, sourceId }, "set_room_state missing roomId");
            return;
          }
          if (!action.state) {
            log.warn({ action, sourceId }, "set_room_state missing state");
            return;
          }
          this.executeRoomAction(action.roomId, action.state, "automation");
          break;
        }

        case "toggle_device": {
          if (!action.deviceId) {
            log.warn({ action, sourceId }, "toggle_device missing deviceId");
            return;
          }
          this.executeToggleAction(action.deviceId, action.channel ?? 0);
          break;
        }

        default: {
          log.warn({ action, sourceId }, "Unknown action type");
        }
      }
    } catch (err) {
      log.error({ err, action, sourceId }, "Error dispatching action");
    }
  }

  // ── Action Helpers ─────────────────────────────────────────────────────────

  private executeDeviceAction(
    deviceId: string,
    channel: number,
    state: "ON" | "OFF",
  ): void {
    // 1. Update hub state (authoritative)
    stateManager.setDeviceState(deviceId, channel, state, "automation");

    // 2. Publish MQTT command to the device
    const device = deviceRegistry.getDevice(deviceId);
    if (!device) {
      log.warn({ deviceId }, "Device not found for automation action");
      return;
    }

    const roomId = device.roomId ?? "unknown";
    const published = mqttGateway.publishCommand(
      roomId,
      deviceId,
      channel,
      state,
    );

    log.info(
      { deviceId, channel, state, roomId, published },
      "Automation action dispatched to device",
    );
  }

  private executeRoomAction(
    roomId: string,
    state: "ON" | "OFF",
    source: "automation" | "api" = "automation",
  ): void {
    const devices = deviceRegistry.listDevicesByRoom(roomId);

    if (devices.length === 0) {
      log.warn({ roomId }, "No devices found in room for automation");
      return;
    }

    for (const device of devices) {
      stateManager.setDeviceState(device.id, 0, state, source);
      mqttGateway.publishCommand(roomId, device.id, 0, state);
    }

    log.info(
      { roomId, state, deviceCount: devices.length },
      "Room action dispatched",
    );
  }

  private executeToggleAction(deviceId: string, channel: number): void {
    const current = stateManager.getDeviceState(deviceId, channel);
    const newState: "ON" | "OFF" = current?.state === "ON" ? "OFF" : "ON";
    this.executeDeviceAction(deviceId, channel, newState);
  }

  // ── Schedule Payload → Action Bridge ───────────────────────────────────────

  /**
   * Convert the raw schedule action JSON into a typed AutomationAction.
   * Schedules store actions as { state: 'ON'|'OFF', channel?: number }.
   */
  private buildActionFromSchedulePayload(
    deviceId: string | undefined,
    roomId: string | undefined,
    rawAction: Record<string, unknown>,
  ): AutomationAction | null {
    const state = rawAction["state"] as "ON" | "OFF" | undefined;
    const channel = (rawAction["channel"] as number | undefined) ?? 0;

    if (!state || (state !== "ON" && state !== "OFF")) {
      return null;
    }

    if (deviceId) {
      return { type: "set_device_state", deviceId, channel, state };
    }

    if (roomId) {
      return { type: "set_room_state", roomId, state };
    }

    return null;
  }

  // ── Automation CRUD ────────────────────────────────────────────────────────

  createAutomation(input: CreateAutomationInput): Automation {
    const db = getDb();
    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    db.prepare<[string, string, string, string, number]>(
      `
      INSERT INTO automations (id, name, trigger, actions, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      input.name,
      JSON.stringify(input.trigger),
      JSON.stringify(input.actions),
      now,
    );

    log.info({ automationId: id, name: input.name }, "Automation created");

    return this.getAutomationOrThrow(id);
  }

  getAutomation(automationId: string): Automation | null {
    const db = getDb();
    const row = db
      .prepare<
        [string],
        DbAutomation
      >("SELECT id, name, trigger, actions, enabled, created_at FROM automations WHERE id = ?")
      .get(automationId);

    return row ? this.mapAutomation(row) : null;
  }

  getAutomationOrThrow(automationId: string): Automation {
    const a = this.getAutomation(automationId);
    if (!a) throw new Error(`Automation not found: ${automationId}`);
    return a;
  }

  listAutomations(): Automation[] {
    const db = getDb();
    const rows = db
      .prepare<
        [],
        DbAutomation
      >("SELECT id, name, trigger, actions, enabled, created_at FROM automations ORDER BY created_at DESC")
      .all();

    return rows.map((r) => this.mapAutomation(r));
  }

  private listAutomationsByTrigger(triggerType: TriggerType): Automation[] {
    // SQLite JSON functions may not be available everywhere, so filter in JS
    return this.listAutomations().filter((a) => a.trigger.type === triggerType);
  }

  updateAutomation(
    automationId: string,
    input: Partial<CreateAutomationInput> & { enabled?: boolean },
  ): Automation {
    const db = getDb();
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      setClauses.push("name = ?");
      values.push(input.name);
    }
    if (input.trigger !== undefined) {
      setClauses.push("trigger = ?");
      values.push(JSON.stringify(input.trigger));
    }
    if (input.actions !== undefined) {
      setClauses.push("actions = ?");
      values.push(JSON.stringify(input.actions));
    }
    if (input.enabled !== undefined) {
      setClauses.push("enabled = ?");
      values.push(input.enabled ? 1 : 0);
    }

    if (setClauses.length === 0) return this.getAutomationOrThrow(automationId);

    values.push(automationId);
    db.prepare(
      `UPDATE automations SET ${setClauses.join(", ")} WHERE id = ?`,
    ).run(...values);

    log.info({ automationId, changes: input }, "Automation updated");

    return this.getAutomationOrThrow(automationId);
  }

  deleteAutomation(automationId: string): void {
    const db = getDb();
    db.prepare("DELETE FROM automations WHERE id = ?").run(automationId);
    log.info({ automationId }, "Automation deleted");
  }

  // ── Mapping ────────────────────────────────────────────────────────────────

  private mapAutomation(row: DbAutomation): Automation {
    let trigger: AutomationTrigger;
    let actions: AutomationAction[];

    try {
      trigger = JSON.parse(row.trigger) as AutomationTrigger;
    } catch {
      trigger = { type: "manual" };
    }

    try {
      actions = JSON.parse(row.actions) as AutomationAction[];
    } catch {
      actions = [];
    }

    return {
      id: row.id,
      name: row.name,
      trigger,
      actions,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const automationEngine = new AutomationEngine();
