import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { createLogger } from "../system/logger.js";
import { deviceRegistry } from "../core/device-registry.js";
import { stateManager } from "../core/state-manager.js";
import { mqttGateway } from "../core/mqtt-gateway.js";
import { automationEngine } from "../core/automation-engine.js";
import { scheduler } from "../core/scheduler.js";
import { requireMcpApiKey } from "../api/middleware/auth.js";
import { config } from "../config/index.js";

const log = createLogger("mcp");

const startupTime = Date.now();

// ─── MCP Types ────────────────────────────────────────────────────────────────

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const tools: McpToolDefinition[] = [
  {
    name: "list_devices",
    description:
      "List all registered smart switch devices in the property. Returns device IDs, names, room assignments, types, and online status.",
    inputSchema: {
      type: "object",
      properties: {
        roomId: {
          type: "string",
          description: "Optional UUID of a room to filter devices by.",
        },
        onlineOnly: {
          type: "boolean",
          description: "If true, only return devices that are currently online.",
        },
      },
    },
  },

  {
    name: "get_device_state",
    description:
      "Get the current ON/OFF state of a specific device channel.",
    inputSchema: {
      type: "object",
      properties: {
        deviceId: {
          type: "string",
          description: "The unique ID of the device.",
        },
        channel: {
          type: "number",
          description: "The relay channel number (0–3). Defaults to 0.",
        },
      },
      required: ["deviceId"],
    },
  },

  {
    name: "set_device_state",
    description:
      "Turn a specific device ON or OFF. The hub updates its state and sends the command to the physical device via MQTT.",
    inputSchema: {
      type: "object",
      properties: {
        deviceId: {
          type: "string",
          description: "The unique ID of the device to control.",
        },
        state: {
          type: "string",
          enum: ["ON", "OFF"],
          description: "The desired state: ON or OFF.",
        },
        channel: {
          type: "number",
          description: "The relay channel number (0–3). Defaults to 0.",
        },
      },
      required: ["deviceId", "state"],
    },
  },

  {
    name: "toggle_device",
    description:
      "Toggle the current state of a device. If it is ON it will be turned OFF, and vice versa.",
    inputSchema: {
      type: "object",
      properties: {
        deviceId: {
          type: "string",
          description: "The unique ID of the device to toggle.",
        },
        channel: {
          type: "number",
          description: "The relay channel number (0–3). Defaults to 0.",
        },
      },
      required: ["deviceId"],
    },
  },

  {
    name: "list_rooms",
    description:
      "List all rooms in the property with their device counts and current states.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  {
    name: "get_room_state",
    description: "Get the current ON/OFF state of all devices in a specific room.",
    inputSchema: {
      type: "object",
      properties: {
        roomId: {
          type: "string",
          description: "The UUID of the room.",
        },
      },
      required: ["roomId"],
    },
  },

  {
    name: "set_room_state",
    description:
      "Turn all devices in a room ON or OFF simultaneously.",
    inputSchema: {
      type: "object",
      properties: {
        roomId: {
          type: "string",
          description: "The UUID of the room to control.",
        },
        state: {
          type: "string",
          enum: ["ON", "OFF"],
          description: "The desired state for all devices in the room.",
        },
      },
      required: ["roomId", "state"],
    },
  },

  {
    name: "list_automations",
    description:
      "List all configured automation rules including their trigger types and actions.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  {
    name: "trigger_automation",
    description:
      "Manually trigger an automation rule by its ID. Useful for testing or manual overrides.",
    inputSchema: {
      type: "object",
      properties: {
        automationId: {
          type: "string",
          description: "The UUID of the automation rule to trigger.",
        },
      },
      required: ["automationId"],
    },
  },

  {
    name: "list_schedules",
    description:
      "List all scheduled automations, including their run times, repeat patterns, and target devices or rooms.",
    inputSchema: {
      type: "object",
      properties: {
        enabledOnly: {
          type: "boolean",
          description: "If true, only return enabled schedules.",
        },
      },
    },
  },

  {
    name: "create_schedule",
    description:
      "Create a new time-based automation schedule targeting a device or an entire room. Supports one-shot and repeating (cron) schedules.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "A human-readable name for this schedule.",
        },
        deviceId: {
          type: "string",
          description: "Target device ID. Provide either deviceId or roomId.",
        },
        roomId: {
          type: "string",
          description: "Target room UUID. Provide either deviceId or roomId.",
        },
        state: {
          type: "string",
          enum: ["ON", "OFF"],
          description: "The state to apply when the schedule fires.",
        },
        runAt: {
          type: "number",
          description:
            "Unix epoch timestamp in seconds when the schedule should fire.",
        },
        repeatCron: {
          type: "string",
          description:
            'Optional 5-field cron expression for repeating schedules (e.g. "0 7 * * *" for 7 AM daily).',
        },
      },
      required: ["name", "state", "runAt"],
    },
  },

  {
    name: "get_system_status",
    description:
      "Get a high-level summary of the hub: MQTT connectivity, device online/offline counts, scheduler state, and uptime.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// ─── Tool Executor ────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<McpToolResult> {
  const text = (msg: string): McpToolResult => ({
    content: [{ type: "text", text: msg }],
  });

  const error = (msg: string): McpToolResult => ({
    content: [{ type: "text", text: `Error: ${msg}` }],
    isError: true,
  });

  try {
    switch (name) {

      // ── list_devices ─────────────────────────────────────────────────────────
      case "list_devices": {
        const roomId    = input["roomId"] as string | undefined;
        const onlineOnly = input["onlineOnly"] as boolean | undefined;

        let devices = deviceRegistry.listDevicesWithStatus();
        if (roomId)     devices = devices.filter((d) => d.roomId === roomId);
        if (onlineOnly) devices = devices.filter((d) => d.online);

        if (devices.length === 0) {
          return text("No devices found matching the criteria.");
        }

        const lines = devices.map((d) => {
          const status = d.online ? "🟢 online" : "🔴 offline";
          const room   = d.roomId ?? "unassigned";
          return `• ${d.name ?? d.id} (id: ${d.id}) | type: ${d.type} | room: ${room} | ${status}`;
        });

        return text(`Found ${devices.length} device(s):\n${lines.join("\n")}`);
      }

      // ── get_device_state ─────────────────────────────────────────────────────
      case "get_device_state": {
        const deviceId = input["deviceId"] as string;
        const channel  = (input["channel"] as number | undefined) ?? 0;

        if (!deviceRegistry.isKnownDevice(deviceId)) {
          return error(`Device not found: ${deviceId}`);
        }

        const state = stateManager.getDeviceState(deviceId, channel);

        if (!state) {
          return text(
            `Device ${deviceId} channel ${channel} has no recorded state (possibly never reported).`,
          );
        }

        const updatedAt = new Date(state.updatedAt * 1000).toISOString();
        return text(
          `Device ${deviceId} channel ${channel} is currently ${state.state} (last updated: ${updatedAt}).`,
        );
      }

      // ── set_device_state ─────────────────────────────────────────────────────
      case "set_device_state": {
        const deviceId = input["deviceId"] as string;
        const state    = input["state"] as "ON" | "OFF";
        const channel  = (input["channel"] as number | undefined) ?? 0;

        if (!["ON", "OFF"].includes(state)) {
          return error(`Invalid state "${state}". Must be ON or OFF.`);
        }

        const device = deviceRegistry.getDeviceWithStatus(deviceId);
        if (!device) {
          return error(`Device not found: ${deviceId}`);
        }

        stateManager.setDeviceState(deviceId, channel, state, "automation");
        const roomId    = device.roomId ?? "unknown";
        const published = mqttGateway.publishCommand(roomId, deviceId, channel, state);

        const deliveryNote = published
          ? "MQTT command delivered."
          : "Warning: MQTT command could not be delivered (broker may be offline). State saved in hub.";

        const deviceName = device.name ?? deviceId;
        return text(`✅ ${deviceName} (channel ${channel}) turned ${state}. ${deliveryNote}`);
      }

      // ── toggle_device ─────────────────────────────────────────────────────────
      case "toggle_device": {
        const deviceId = input["deviceId"] as string;
        const channel  = (input["channel"] as number | undefined) ?? 0;

        const device = deviceRegistry.getDeviceWithStatus(deviceId);
        if (!device) {
          return error(`Device not found: ${deviceId}`);
        }

        const updatedState = stateManager.toggleDeviceState(deviceId, channel, "automation");
        const roomId       = device.roomId ?? "unknown";
        mqttGateway.publishCommand(roomId, deviceId, channel, updatedState.state);

        const deviceName = device.name ?? deviceId;
        return text(`🔄 ${deviceName} (channel ${channel}) toggled → now ${updatedState.state}.`);
      }

      // ── list_rooms ────────────────────────────────────────────────────────────
      case "list_rooms": {
        const rooms = deviceRegistry.listRooms();

        if (rooms.length === 0) {
          return text("No rooms configured.");
        }

        const lines = rooms.map((r) => {
          const devices = deviceRegistry.listDevicesByRoom(r.id);
          const online  = devices.filter((d) => d.online).length;
          return `• ${r.name} (id: ${r.id}) | ${devices.length} device(s), ${online} online`;
        });

        return text(`Found ${rooms.length} room(s):\n${lines.join("\n")}`);
      }

      // ── get_room_state ────────────────────────────────────────────────────────
      case "get_room_state": {
        const roomId = input["roomId"] as string;

        const room = deviceRegistry.getRoom(roomId);
        if (!room) {
          return error(`Room not found: ${roomId}`);
        }

        const roomState = stateManager.getRoomState(roomId);
        const devices   = deviceRegistry.listDevicesByRoom(roomId);

        if (devices.length === 0) {
          return text(`Room "${room.name}" has no devices assigned.`);
        }

        const lines = devices.map((d) => {
          const ds      = roomState.devices.find((s) => s.deviceId === d.id);
          const stateStr = ds?.state ?? "UNKNOWN";
          const status  = d.online ? "🟢" : "🔴";
          return `  ${status} ${d.name ?? d.id}: ${stateStr}`;
        });

        return text(`Room "${room.name}" device states:\n${lines.join("\n")}`);
      }

      // ── set_room_state ────────────────────────────────────────────────────────
      case "set_room_state": {
        const roomId = input["roomId"] as string;
        const state  = input["state"] as "ON" | "OFF";

        if (!["ON", "OFF"].includes(state)) {
          return error(`Invalid state "${state}". Must be ON or OFF.`);
        }

        const room = deviceRegistry.getRoom(roomId);
        if (!room) {
          return error(`Room not found: ${roomId}`);
        }

        const devices = deviceRegistry.listDevicesByRoom(roomId);
        if (devices.length === 0) {
          return error(`Room "${room.name}" has no devices to control.`);
        }

        stateManager.setRoomState(roomId, state, "automation");

        let published = 0;
        for (const device of devices) {
          if (mqttGateway.publishCommand(roomId, device.id, 0, state)) {
            published++;
          }
        }

        return text(
          `✅ All ${devices.length} device(s) in "${room.name}" turned ${state}. MQTT delivered to ${published}/${devices.length}.`,
        );
      }

      // ── list_automations ──────────────────────────────────────────────────────
      case "list_automations": {
        const automations = automationEngine.listAutomations();

        if (automations.length === 0) {
          return text("No automation rules configured.");
        }

        const lines = automations.map((a) => {
          const status = a.enabled ? "✅" : "⏸️";
          return `${status} ${a.name} (id: ${a.id}) | trigger: ${a.trigger.type} | actions: ${a.actions.length}`;
        });

        return text(`Found ${automations.length} automation(s):\n${lines.join("\n")}`);
      }

      // ── trigger_automation ────────────────────────────────────────────────────
      case "trigger_automation": {
        const automationId = input["automationId"] as string;

        const automation = automationEngine.getAutomation(automationId);
        if (!automation) {
          return error(`Automation not found: ${automationId}`);
        }

        if (!automation.enabled) {
          return error(`Automation "${automation.name}" is disabled and cannot be triggered.`);
        }

        for (const action of automation.actions) {
          if (action.type === "set_device_state" && action.deviceId && action.state) {
            stateManager.setDeviceState(
              action.deviceId,
              action.channel ?? 0,
              action.state,
              "automation",
            );
            const device = deviceRegistry.getDevice(action.deviceId);
            if (device) {
              mqttGateway.publishCommand(
                device.roomId ?? "unknown",
                action.deviceId,
                action.channel ?? 0,
                action.state,
              );
            }
          } else if (action.type === "set_room_state" && action.roomId && action.state) {
            stateManager.setRoomState(action.roomId, action.state, "automation");
            const devices = deviceRegistry.listDevicesByRoom(action.roomId);
            for (const d of devices) {
              mqttGateway.publishCommand(action.roomId, d.id, 0, action.state!);
            }
          }
        }

        return text(
          `✅ Automation "${automation.name}" triggered. Executed ${automation.actions.length} action(s).`,
        );
      }

      // ── list_schedules ────────────────────────────────────────────────────────
      case "list_schedules": {
        const enabledOnly = input["enabledOnly"] as boolean | undefined;
        const schedules   = scheduler.listSchedules(enabledOnly ?? false);

        if (schedules.length === 0) {
          return text("No schedules found.");
        }

        const lines = schedules.map((s) => {
          const status  = s.enabled ? "✅" : "⏸️";
          const runAt   = new Date(s.runAt * 1000).toISOString();
          const target  = s.deviceId ?? s.roomId ?? "unknown";
          const repeat  = s.repeatCron ? ` | repeats: ${s.repeatCron}` : " | one-shot";
          return `${status} ${s.name} (id: ${s.id}) | fires: ${runAt} | target: ${target}${repeat}`;
        });

        return text(`Found ${schedules.length} schedule(s):\n${lines.join("\n")}`);
      }

      // ── create_schedule ───────────────────────────────────────────────────────
      case "create_schedule": {
        const nameVal    = input["name"] as string;
        const deviceId   = input["deviceId"] as string | undefined;
        const roomId     = input["roomId"] as string | undefined;
        const state      = input["state"] as "ON" | "OFF";
        const runAt      = input["runAt"] as number;
        const repeatCron = input["repeatCron"] as string | undefined;

        if (!nameVal)                         return error("name is required.");
        if (!["ON", "OFF"].includes(state))   return error("state must be ON or OFF.");
        if (!deviceId && !roomId)             return error("Either deviceId or roomId must be provided.");
        if (!runAt)                           return error("runAt (Unix epoch seconds) is required.");

        const nowSec = Math.floor(Date.now() / 1000);
        if (!repeatCron && runAt <= nowSec) {
          return error("runAt must be a future timestamp for one-shot schedules.");
        }

        if (deviceId && !deviceRegistry.isKnownDevice(deviceId)) {
          return error(`Device not found: ${deviceId}`);
        }
        if (roomId && !deviceRegistry.getRoom(roomId)) {
          return error(`Room not found: ${roomId}`);
        }

        const schedule = scheduler.createSchedule({
          name:       nameVal,
          deviceId,
          roomId,
          action:     { state, channel: 0 },
          runAt,
          repeatCron,
        });

        const runAtIso   = new Date(runAt * 1000).toISOString();
        const repeatNote = repeatCron
          ? ` Repeats on cron: ${repeatCron}.`
          : " One-shot schedule.";

        return text(
          `✅ Schedule "${schedule.name}" created (id: ${schedule.id}). Fires at ${runAtIso}.${repeatNote}`,
        );
      }

      // ── get_system_status ─────────────────────────────────────────────────────
      case "get_system_status": {
        const totalDevices     = deviceRegistry.getTotalCount();
        const onlineDevices    = deviceRegistry.getOnlineCount();
        const mqttConnected    = mqttGateway.isConnected;
        const schedulerRunning = scheduler.isRunning;
        const rooms            = deviceRegistry.listRooms();

        const uptimeSec = Math.floor((Date.now() - startupTime) / 1000);
        const d = Math.floor(uptimeSec / 86400);
        const h = Math.floor((uptimeSec % 86400) / 3600);
        const m = Math.floor((uptimeSec % 3600) / 60);
        const uptimeStr = `${d}d ${h}h ${m}m`;

        const mqttStatus      = mqttConnected    ? "🟢 connected" : "🔴 disconnected";
        const schedulerStatus = schedulerRunning ? "🟢 running"   : "🔴 stopped";

        return text(
          [
            `🏠 Zapp Hub Status — ${config.hub.name} (${config.hub.propertyId})`,
            ``,
            `⏱️  Uptime:     ${uptimeStr}`,
            `📡 MQTT:       ${mqttStatus} → ${config.mqtt.brokerUrl}`,
            `⏰ Scheduler:  ${schedulerStatus}`,
            ``,
            `📦 Devices:    ${onlineDevices}/${totalDevices} online`,
            `🏠 Rooms:      ${rooms.length}`,
            ``,
            `Node.js ${process.version} | ${process.platform}/${process.arch}`,
          ].join("\n"),
        );
      }

      default:
        return error(`Unknown tool: "${name}"`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, toolName: name, input }, "Tool execution error");
    return error(`Internal error executing tool "${name}": ${message}`);
  }
}

// ─── Fastify Plugin ───────────────────────────────────────────────────────────

export async function mcpRoutes(fastify: FastifyInstance): Promise<void> {
  if (!config.mcp.enabled) {
    log.info("MCP interface is disabled (MCP_ENABLED=false)");
    return;
  }

  log.info(`MCP tool server registered (${tools.length} tools)`);

  /**
   * GET /mcp/tools
   *
   * Returns the list of available tools and their JSON Schema input schemas.
   * LLM clients call this to discover what capabilities are available.
   */
  fastify.get(
    "/mcp/tools",
    { preHandler: [requireMcpApiKey] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.status(200).send({
        tools,
        count:   tools.length,
        version: "1.0.0",
        hub: {
          name:       config.hub.name,
          propertyId: config.hub.propertyId,
        },
      });
    },
  );

  /**
   * POST /mcp/tools/call
   *
   * Execute a tool by name with the provided input parameters.
   * Follows the MCP protocol's tools/call message envelope:
   *
   *   { "name": "set_device_state", "input": { "deviceId": "abc", "state": "ON" } }
   */
  fastify.post(
    "/mcp/tools/call",
    { preHandler: [requireMcpApiKey] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const schema = z.object({
        name:  z.string().min(1, "Tool name is required"),
        input: z.record(z.unknown()).default({}),
      });

      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error:   "Invalid request body",
          details: parsed.error.errors,
        });
      }

      const { name, input } = parsed.data;

      const toolDef = tools.find((t) => t.name === name);
      if (!toolDef) {
        return reply.status(404).send({
          error:          `Tool not found: "${name}"`,
          availableTools: tools.map((t) => t.name),
        });
      }

      log.info({ toolName: name, input }, "MCP tool called");

      const result = await executeTool(name, input);

      log.info(
        { toolName: name, isError: result.isError ?? false },
        "MCP tool execution complete",
      );

      return reply.status(result.isError ? 422 : 200).send(result);
    },
  );

  /**
   * POST /mcp/tools/:name
   *
   * Convenience endpoint — call a tool directly by URL path.
   * The request body is passed straight through as the tool input,
   * without the { name, input } wrapper envelope.
   *
   * Example:
   *   POST /mcp/tools/set_device_state
   *   { "deviceId": "abc123", "state": "ON" }
   */
  fastify.post<{ Params: { name: string } }>(
    "/mcp/tools/:name",
    { preHandler: [requireMcpApiKey] },
    async (request, reply) => {
      const { name } = request.params;

      const toolDef = tools.find((t) => t.name === name);
      if (!toolDef) {
        return reply.status(404).send({
          error:          `Tool not found: "${name}"`,
          availableTools: tools.map((t) => t.name),
        });
      }

      const input = (request.body ?? {}) as Record<string, unknown>;

      log.info({ toolName: name, input }, "MCP tool called (direct)");

      const result = await executeTool(name, input);

      return reply.status(result.isError ? 422 : 200).send(result);
    },
  );

  /**
   * GET /mcp/tools/:name
   *
   * Get the schema definition for a single tool.
   * Lets LLM clients introspect individual tool capabilities.
   */
  fastify.get<{ Params: { name: string } }>(
    "/mcp/tools/:name",
    { preHandler: [requireMcpApiKey] },
    async (request, reply) => {
      const { name } = request.params;

      const toolDef = tools.find((t) => t.name === name);
      if (!toolDef) {
        return reply.status(404).send({
          error:          `Tool not found: "${name}"`,
          availableTools: tools.map((t) => t.name),
        });
      }

      return reply.status(200).send(toolDef);
    },
  );
}
