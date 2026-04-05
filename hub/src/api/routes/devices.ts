import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { deviceRegistry } from "../../core/device-registry.js";
import { stateManager } from "../../core/state-manager.js";
import { mqttGateway } from "../../core/mqtt-gateway.js";
import { eventBus, EventTypes } from "../../core/event-bus.js";
import { getDb } from "../../db/index.js";
import { createLogger } from "../../system/logger.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

type EventRow = {
  id: number;
  type: string;
  device_id: string | null;
  room_id: string | null;
  payload: string;
  timestamp: number;
};

const log = createLogger("api:devices");

// ─── Validation Schemas ───────────────────────────────────────────────────────

const DeviceActionSchema = z.object({
  state: z.enum(["ON", "OFF"]),
  channel: z.number().int().min(0).max(3).default(0),
});

const RegisterDeviceSchema = z.object({
  deviceId: z.string().min(1).max(64).optional(),
  roomId: z.string().uuid().optional(),
  type: z.enum(["relay", "ir", "sensor"]).default("relay"),
  name: z.string().min(1).max(128).optional(),
  ipAddress: z.string().ip().optional(),
});

const UpdateDeviceSchema = z.object({
  roomId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(128).optional(),
  ipAddress: z.string().ip().optional(),
});

const CreateRoomSchema = z.object({
  name: z.string().min(1).max(128),
  propertyId: z.string().min(1).max(64).optional(),
});

const UpdateRoomSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  propertyId: z.string().min(1).max(64).optional(),
});

const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  roomId: z.string().uuid().optional(),
  type: z.string().optional(),
  online: z.enum(["true", "false"]).optional(),
});

// ─── Route Param Schemas ──────────────────────────────────────────────────────

interface DeviceParams {
  id: string;
}

interface RoomParams {
  id: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok<T>(reply: FastifyReply, data: T, statusCode = 200) {
  return reply.status(statusCode).send({ ok: true, data });
}

function fail(
  reply: FastifyReply,
  statusCode: number,
  message: string,
  code?: string,
) {
  return reply.status(statusCode).send({
    ok: false,
    error: { message, code: code ?? "ERROR" },
  });
}

function parseBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
  reply: FastifyReply,
): { data: T; error: false } | { data: null; error: true } {
  const result = schema.safeParse(body);
  if (!result.success) {
    fail(
      reply,
      400,
      result.error.errors.map((e) => e.message).join("; "),
      "VALIDATION_ERROR",
    );
    return { data: null, error: true };
  }
  return { data: result.data, error: false };
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function devicesRoutes(fastify: FastifyInstance): Promise<void> {
  // ════════════════════════════════════════════════════════════════════════════
  // DEVICES
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * GET /devices
   * List all registered devices with their current state and online status.
   * Supports optional filtering by roomId, type, online status.
   */
  fastify.get(
    "/devices",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const queryResult = PaginationSchema.safeParse(request.query);
      if (!queryResult.success) {
        return fail(reply, 400, "Invalid query parameters", "VALIDATION_ERROR");
      }

      const { page, limit, roomId, type, online } = queryResult.data;

      let devices = deviceRegistry.listDevicesWithStatus();

      // Apply filters
      if (roomId) {
        devices = devices.filter((d) => d.roomId === roomId);
      }
      if (type) {
        devices = devices.filter((d) => d.type === type);
      }
      if (online !== undefined) {
        const wantOnline = online === "true";
        devices = devices.filter((d) => d.online === wantOnline);
      }

      // Enrich with latest state per device
      const enriched = devices.map((device) => {
        const states = stateManager.getDeviceStates(device.id);
        return {
          ...device,
          states,
        };
      });

      // Paginate
      const total = enriched.length;
      const offset = (page - 1) * limit;
      const items = enriched.slice(offset, offset + limit);

      log.debug({ count: items.length, total, page, limit }, "Devices listed");

      return ok(reply, {
        items,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    },
  );

  /**
   * GET /devices/:id
   * Get a single device by ID with its current state.
   */
  fastify.get<{ Params: DeviceParams }>(
    "/devices/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;

      const device = deviceRegistry.getDeviceWithStatus(id);
      if (!device) {
        return fail(reply, 404, `Device not found: ${id}`, "DEVICE_NOT_FOUND");
      }

      const states = stateManager.getDeviceStates(id);

      return ok(reply, { ...device, states });
    },
  );

  /**
   * POST /devices
   * Manually register a device (auto-registration via MQTT is also supported).
   */
  fastify.post(
    "/devices",
    { preHandler: [requireAuth, requireRole("admin", "operator")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = parseBody(RegisterDeviceSchema, request.body, reply);
      if (parsed.error) return;

      const { deviceId, roomId, type, name, ipAddress } = parsed.data;

      // Validate room exists if provided
      if (roomId) {
        const room = deviceRegistry.getRoom(roomId);
        if (!room) {
          return fail(
            reply,
            404,
            `Room not found: ${roomId}`,
            "ROOM_NOT_FOUND",
          );
        }
      }

      try {
        const device = deviceRegistry.registerDevice({
          deviceId,
          roomId,
          type,
          name,
          ipAddress,
        });

        log.info(
          { deviceId: device.id, roomId, type },
          "Device manually registered via API",
        );

        return ok(reply, device, 201);
      } catch (err) {
        log.error({ err }, "Failed to register device");
        return fail(reply, 500, "Failed to register device", "INTERNAL_ERROR");
      }
    },
  );

  /**
   * PATCH /devices/:id
   * Update device metadata (room assignment, name, IP).
   */
  fastify.patch<{ Params: DeviceParams }>(
    "/devices/:id",
    { preHandler: [requireAuth, requireRole("admin", "operator")] },
    async (request, reply) => {
      const { id } = request.params;

      if (!deviceRegistry.isKnownDevice(id)) {
        return fail(reply, 404, `Device not found: ${id}`, "DEVICE_NOT_FOUND");
      }

      const parsed = parseBody(UpdateDeviceSchema, request.body, reply);
      if (parsed.error) return;

      const { roomId, name, ipAddress } = parsed.data;

      // Validate room if provided
      if (roomId !== undefined && roomId !== null) {
        const room = deviceRegistry.getRoom(roomId);
        if (!room) {
          return fail(
            reply,
            404,
            `Room not found: ${roomId}`,
            "ROOM_NOT_FOUND",
          );
        }
      }

      try {
        const updated = deviceRegistry.updateDevice(id, {
          roomId: roomId ?? undefined,
          name: name ?? undefined,
          ipAddress: ipAddress ?? undefined,
        });

        return ok(reply, updated);
      } catch (err) {
        log.error({ err, deviceId: id }, "Failed to update device");
        return fail(reply, 500, "Failed to update device", "INTERNAL_ERROR");
      }
    },
  );

  /**
   * DELETE /devices/:id
   * Remove a device from the registry.
   */
  fastify.delete<{ Params: DeviceParams }>(
    "/devices/:id",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const { id } = request.params;

      if (!deviceRegistry.isKnownDevice(id)) {
        return fail(reply, 404, `Device not found: ${id}`, "DEVICE_NOT_FOUND");
      }

      try {
        deviceRegistry.removeDevice(id);
        return ok(reply, { deviceId: id, deleted: true });
      } catch (err) {
        log.error({ err, deviceId: id }, "Failed to remove device");
        return fail(reply, 500, "Failed to remove device", "INTERNAL_ERROR");
      }
    },
  );

  /**
   * POST /devices/:id/action
   * Send a control command to a device (ON / OFF on a specific channel).
   * This is the primary control endpoint used by the dashboard and automations.
   *
   * Flow:
   *   1. Validate device exists
   *   2. Update hub state (authoritative)
   *   3. Publish MQTT command to device
   *   4. Return updated state
   */
  fastify.post<{ Params: DeviceParams }>(
    "/devices/:id/action",
    { preHandler: [requireAuth, requireRole("admin", "operator")] },
    async (request, reply) => {
      const { id } = request.params;

      const device = deviceRegistry.getDeviceWithStatus(id);
      if (!device) {
        return fail(reply, 404, `Device not found: ${id}`, "DEVICE_NOT_FOUND");
      }

      const parsed = parseBody(DeviceActionSchema, request.body, reply);
      if (parsed.error) return;

      const { state } = parsed.data;
      const channel = parsed.data.channel ?? 0;

      // 1. Update hub state (source of truth)
      const updatedState = stateManager.setDeviceState(
        id,
        channel,
        state,
        "api",
      );

      // 2. Publish MQTT command to physical device
      const roomId = device.roomId ?? "unknown";
      const published = mqttGateway.publishCommand(roomId, id, channel, state);

      // 3. Emit command event for audit log
      eventBus.emit(EventTypes.DEVICE_COMMAND_SENT, {
        deviceId: id,
        channel,
        state,
        timestamp: Date.now(),
      });

      log.info(
        {
          deviceId: id,
          channel,
          state,
          roomId,
          mqttPublished: published,
          userId: request.authUser?.id,
        },
        "Device action executed via API",
      );

      return ok(reply, {
        deviceId: id,
        channel,
        state: updatedState.state,
        updatedAt: updatedState.updatedAt,
        mqttDelivered: published,
      });
    },
  );

  /**
   * POST /devices/:id/toggle
   * Toggle the current state of a device channel.
   */
  fastify.post<{ Params: DeviceParams }>(
    "/devices/:id/toggle",
    { preHandler: [requireAuth, requireRole("admin", "operator")] },
    async (request, reply) => {
      const { id } = request.params;

      const device = deviceRegistry.getDeviceWithStatus(id);
      if (!device) {
        return fail(reply, 404, `Device not found: ${id}`, "DEVICE_NOT_FOUND");
      }

      const channelSchema = z.object({
        channel: z.number().int().min(0).max(3).default(0),
      });
      const parsed = channelSchema.safeParse(request.body ?? {});
      const channel = parsed.success ? parsed.data.channel : 0;

      const updatedState = stateManager.toggleDeviceState(id, channel, "api");

      const roomId = device.roomId ?? "unknown";
      const published = mqttGateway.publishCommand(
        roomId,
        id,
        channel,
        updatedState.state,
      );

      log.info(
        {
          deviceId: id,
          channel,
          newState: updatedState.state,
          mqttPublished: published,
        },
        "Device toggled via API",
      );

      return ok(reply, {
        deviceId: id,
        channel,
        state: updatedState.state,
        updatedAt: updatedState.updatedAt,
        mqttDelivered: published,
      });
    },
  );

  /**
   * GET /devices/:id/state
   * Get the current state of all channels on a device.
   */
  fastify.get<{ Params: DeviceParams }>(
    "/devices/:id/state",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;

      if (!deviceRegistry.isKnownDevice(id)) {
        return fail(reply, 404, `Device not found: ${id}`, "DEVICE_NOT_FOUND");
      }

      const states = stateManager.getDeviceStates(id);

      return ok(reply, { deviceId: id, states });
    },
  );

  /**
   * GET /devices/:id/events
   * Get recent events for a specific device (last 100).
   */
  fastify.get<{ Params: DeviceParams }>(
    "/devices/:id/events",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;

      if (!deviceRegistry.isKnownDevice(id)) {
        return fail(reply, 404, `Device not found: ${id}`, "DEVICE_NOT_FOUND");
      }

      const limitSchema = z.object({
        limit: z.coerce.number().int().min(1).max(500).default(100),
      });
      const { limit } = limitSchema.parse(request.query ?? {});

      const db = getDb();
      const events = db
        .prepare<[string, number]>(
          `
          SELECT id, type, device_id, room_id, payload, timestamp
          FROM   events
          WHERE  device_id = ?
          ORDER  BY timestamp DESC
          LIMIT  ?
        `,
        )
        .all(id, limit);

      const parsed = (events as EventRow[]).map((e) => ({
        ...e,
        payload: (() => {
          try {
            return JSON.parse(e.payload);
          } catch {
            return e.payload;
          }
        })(),
      }));

      return ok(reply, { deviceId: id, events: parsed, count: parsed.length });
    },
  );

  // ════════════════════════════════════════════════════════════════════════════
  // ROOMS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * GET /rooms
   * List all rooms with their devices and current states.
   */
  fastify.get(
    "/rooms",
    { preHandler: [requireAuth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const rooms = deviceRegistry.listRooms();

      const enriched = rooms.map((room) => {
        const devices = deviceRegistry.listDevicesByRoom(room.id);
        const roomState = stateManager.getRoomState(room.id);

        return {
          ...room,
          deviceCount: devices.length,
          devices,
          states: roomState.devices,
        };
      });

      return ok(reply, { items: enriched, total: enriched.length });
    },
  );

  /**
   * GET /rooms/:id
   * Get a single room with all its devices and states.
   */
  fastify.get<{ Params: RoomParams }>(
    "/rooms/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;

      const room = deviceRegistry.getRoom(id);
      if (!room) {
        return fail(reply, 404, `Room not found: ${id}`, "ROOM_NOT_FOUND");
      }

      const devices = deviceRegistry.listDevicesByRoom(id);
      const roomState = stateManager.getRoomState(id);

      return ok(reply, {
        ...room,
        deviceCount: devices.length,
        devices,
        states: roomState.devices,
      });
    },
  );

  /**
   * POST /rooms
   * Create a new room.
   */
  fastify.post(
    "/rooms",
    { preHandler: [requireAuth, requireRole("admin", "operator")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = parseBody(CreateRoomSchema, request.body, reply);
      if (parsed.error) return;

      try {
        const room = deviceRegistry.createRoom(parsed.data);
        log.info({ roomId: room.id, name: room.name }, "Room created via API");
        return ok(reply, room, 201);
      } catch (err) {
        log.error({ err }, "Failed to create room");
        return fail(reply, 500, "Failed to create room", "INTERNAL_ERROR");
      }
    },
  );

  /**
   * PATCH /rooms/:id
   * Update room metadata.
   */
  fastify.patch<{ Params: RoomParams }>(
    "/rooms/:id",
    { preHandler: [requireAuth, requireRole("admin", "operator")] },
    async (request, reply) => {
      const { id } = request.params;

      const room = deviceRegistry.getRoom(id);
      if (!room) {
        return fail(reply, 404, `Room not found: ${id}`, "ROOM_NOT_FOUND");
      }

      const parsed = parseBody(UpdateRoomSchema, request.body, reply);
      if (parsed.error) return;

      try {
        const updated = deviceRegistry.updateRoom(id, parsed.data);
        return ok(reply, updated);
      } catch (err) {
        log.error({ err, roomId: id }, "Failed to update room");
        return fail(reply, 500, "Failed to update room", "INTERNAL_ERROR");
      }
    },
  );

  /**
   * DELETE /rooms/:id
   * Delete a room. Devices assigned to this room will have their room_id set to NULL.
   */
  fastify.delete<{ Params: RoomParams }>(
    "/rooms/:id",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const { id } = request.params;

      const room = deviceRegistry.getRoom(id);
      if (!room) {
        return fail(reply, 404, `Room not found: ${id}`, "ROOM_NOT_FOUND");
      }

      try {
        deviceRegistry.deleteRoom(id);
        return ok(reply, { roomId: id, deleted: true });
      } catch (err) {
        log.error({ err, roomId: id }, "Failed to delete room");
        return fail(reply, 500, "Failed to delete room", "INTERNAL_ERROR");
      }
    },
  );

  /**
   * POST /rooms/:id/action
   * Control all devices in a room at once.
   */
  fastify.post<{ Params: RoomParams }>(
    "/rooms/:id/action",
    { preHandler: [requireAuth, requireRole("admin", "operator")] },
    async (request, reply) => {
      const { id } = request.params;

      const room = deviceRegistry.getRoom(id);
      if (!room) {
        return fail(reply, 404, `Room not found: ${id}`, "ROOM_NOT_FOUND");
      }

      const parsed = parseBody(
        z.object({ state: z.enum(["ON", "OFF"]) }),
        request.body,
        reply,
      );
      if (parsed.error) return;

      const { state } = parsed.data;

      const devices = deviceRegistry.listDevicesByRoom(id);
      if (devices.length === 0) {
        return fail(reply, 422, "No devices in this room", "NO_DEVICES");
      }

      const results = stateManager.setRoomState(id, state, "api");

      // Publish MQTT commands for each device
      let published = 0;
      for (const device of devices) {
        const ok2 = mqttGateway.publishCommand(id, device.id, 0, state);
        if (ok2) published++;
      }

      log.info(
        {
          roomId: id,
          state,
          deviceCount: devices.length,
          mqttPublished: published,
          userId: request.authUser?.id,
        },
        "Room action executed via API",
      );

      return ok(reply, {
        roomId: id,
        state,
        devicesAffected: results.length,
        mqttDelivered: published,
        states: results,
      });
    },
  );

  /**
   * GET /rooms/:id/state
   * Get the current state of all devices in a room.
   */
  fastify.get<{ Params: RoomParams }>(
    "/rooms/:id/state",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;

      const room = deviceRegistry.getRoom(id);
      if (!room) {
        return fail(reply, 404, `Room not found: ${id}`, "ROOM_NOT_FOUND");
      }

      const roomState = stateManager.getRoomState(id);

      return ok(reply, roomState);
    },
  );
}
