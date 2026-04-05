import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { getDb } from "../../db/index.js";
import { createLogger } from "../../system/logger.js";
import { eventBus, EventTypes } from "../../core/event-bus.js";
import { deviceRegistry } from "../../core/device-registry.js";
import { stateManager } from "../../core/state-manager.js";
import { scheduler } from "../../core/scheduler.js";
import { automationEngine } from "../../core/automation-engine.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { v4 as uuidv4 } from "uuid";

const log = createLogger("api:guests");

// ─── Validation Schemas ───────────────────────────────────────────────────────

const CheckinSchema = z.object({
  guestId: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(128).optional(),
  roomId: z.string().uuid("roomId must be a valid UUID"),
  checkinTime: z.number().int().positive().optional(), // Unix epoch seconds; defaults to now
});

const CheckoutSchema = z.object({
  guestId: z.string().min(1).max(64),
  checkoutTime: z.number().int().positive().optional(),
});

const CreateScheduleSchema = z.object({
  name: z.string().min(1).max(128),
  deviceId: z.string().min(1).optional(),
  roomId: z.string().uuid().optional(),
  action: z.object({
    state: z.enum(["ON", "OFF"]),
    channel: z.number().int().min(0).max(3).default(0),
  }),
  runAt: z
    .number()
    .int()
    .positive("runAt must be a Unix epoch timestamp in seconds"),
  repeatCron: z
    .string()
    .regex(
      /^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/,
      "repeatCron must be a valid 5-field cron expression",
    )
    .optional(),
});

const UpdateScheduleSchema = CreateScheduleSchema.partial().extend({
  enabled: z.boolean().optional(),
});

const CreateAutomationSchema = z.object({
  name: z.string().min(1).max(128),
  trigger: z.object({
    type: z.enum([
      "schedule",
      "guest_checkin",
      "guest_checkout",
      "device_state",
      "manual",
    ]),
    roomId: z.string().uuid().optional(),
    deviceId: z.string().min(1).optional(),
    state: z.enum(["ON", "OFF"]).optional(),
  }),
  actions: z
    .array(
      z.object({
        type: z.enum(["set_device_state", "set_room_state", "toggle_device"]),
        deviceId: z.string().min(1).optional(),
        roomId: z.string().uuid().optional(),
        channel: z.number().int().min(0).max(3).default(0),
        state: z.enum(["ON", "OFF"]).optional(),
        delaySeconds: z.number().int().min(0).max(3600).optional(),
      }),
    )
    .min(1, "At least one action is required"),
});

const UpdateAutomationSchema = CreateAutomationSchema.partial().extend({
  enabled: z.boolean().optional(),
});

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
      result.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join("; "),
      "VALIDATION_ERROR",
    );
    return { data: null, error: true };
  }
  return { data: result.data, error: false };
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function guestsRoutes(fastify: FastifyInstance): Promise<void> {
  // ════════════════════════════════════════════════════════════════════════════
  // PMS / GUESTS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * POST /guest/checkin
   *
   * PMS integration entry point. When a guest checks in:
   *   1. Record the guest in the DB
   *   2. Emit GUEST_CHECKIN event → automation engine turns on room devices
   *   3. Return the guest record and a summary of devices activated
   *
   * Example payload:
   *   { "guestId": "G123", "roomId": "uuid", "checkinTime": 1712000000 }
   */
  fastify.post(
    "/guest/checkin",
    { preHandler: [requireAuth, requireRole("admin", "operator")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = parseBody(CheckinSchema, request.body, reply);
      if (parsed.error) return;

      const { roomId, name } = parsed.data;
      const guestId = parsed.data.guestId ?? uuidv4();
      const checkinTime =
        parsed.data.checkinTime ?? Math.floor(Date.now() / 1000);

      // ── Validate room ─────────────────────────────────────────────────────
      const room = deviceRegistry.getRoom(roomId);
      if (!room) {
        return fail(reply, 404, `Room not found: ${roomId}`, "ROOM_NOT_FOUND");
      }

      const db = getDb();

      // ── Check for existing active guest in this room ────────────────────
      const existingGuest = db
        .prepare<
          [string],
          { id: string; name: string | null }
        >("SELECT id, name FROM guests WHERE room_id = ? AND active = 1 LIMIT 1")
        .get(roomId);

      if (existingGuest) {
        log.warn(
          { existingGuestId: existingGuest.id, roomId },
          "Room already has an active guest — proceeding with new check-in",
        );
        // Mark the previous guest as checked out
        db.prepare(
          "UPDATE guests SET active = 0, checkout_time = ? WHERE id = ?",
        ).run(checkinTime, existingGuest.id);
      }

      // ── Upsert guest record ────────────────────────────────────────────────
      db.prepare(
        `
        INSERT INTO guests (id, name, room_id, checkin_time, active, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
        ON CONFLICT (id) DO UPDATE SET
          room_id      = excluded.room_id,
          checkin_time = excluded.checkin_time,
          active       = 1,
          checkout_time = NULL
      `,
      ).run(guestId, name ?? null, roomId, checkinTime, checkinTime);

      log.info({ guestId, roomId, name, checkinTime }, "Guest checked in");

      // ── Emit event → automation engine reacts ─────────────────────────────
      eventBus.emit(EventTypes.GUEST_CHECKIN, {
        guestId,
        roomId,
        checkinTime,
        timestamp: Date.now(),
      });

      // ── Collect devices that will be activated ─────────────────────────────
      const devices = deviceRegistry.listDevicesByRoom(roomId);
      const activatedStates = stateManager.getRoomState(roomId);

      return ok(
        reply,
        {
          guest: {
            id: guestId,
            name,
            roomId,
            checkinTime,
            active: true,
          },
          room: {
            id: room.id,
            name: room.name,
          },
          devicesActivated: devices.length,
          states: activatedStates.devices,
        },
        201,
      );
    },
  );

  /**
   * POST /guest/checkout
   *
   * Mark a guest as checked out.
   *   1. Deactivate the guest record
   *   2. Emit GUEST_CHECKOUT → automation engine turns off room devices
   *   3. Return summary
   */
  fastify.post(
    "/guest/checkout",
    { preHandler: [requireAuth, requireRole("admin", "operator")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = parseBody(CheckoutSchema, request.body, reply);
      if (parsed.error) return;

      const { guestId } = parsed.data;
      const checkoutTime =
        parsed.data.checkoutTime ?? Math.floor(Date.now() / 1000);

      const db = getDb();

      const guest = db
        .prepare<
          [string],
          {
            id: string;
            name: string | null;
            room_id: string | null;
            active: number;
          }
        >("SELECT id, name, room_id, active FROM guests WHERE id = ?")
        .get(guestId);

      if (!guest) {
        return fail(
          reply,
          404,
          `Guest not found: ${guestId}`,
          "GUEST_NOT_FOUND",
        );
      }

      if (!guest.active) {
        return fail(
          reply,
          409,
          "Guest is already checked out",
          "ALREADY_CHECKED_OUT",
        );
      }

      // ── Mark as checked out ───────────────────────────────────────────────
      db.prepare(
        "UPDATE guests SET active = 0, checkout_time = ? WHERE id = ?",
      ).run(checkoutTime, guestId);

      log.info(
        { guestId, roomId: guest.room_id, checkoutTime },
        "Guest checked out",
      );

      // ── Emit event → automation engine reacts ─────────────────────────────
      if (guest.room_id) {
        eventBus.emit(EventTypes.GUEST_CHECKOUT, {
          guestId,
          roomId: guest.room_id,
          checkoutTime,
          timestamp: Date.now(),
        });
      }

      const devices = guest.room_id
        ? deviceRegistry.listDevicesByRoom(guest.room_id)
        : [];

      return ok(reply, {
        guest: {
          id: guestId,
          name: guest.name,
          roomId: guest.room_id,
          checkoutTime,
          active: false,
        },
        devicesDeactivated: devices.length,
      });
    },
  );

  /**
   * GET /guest/active
   * List all currently active guests.
   */
  fastify.get(
    "/guest/active",
    { preHandler: [requireAuth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const db = getDb();

      const guests = db
        .prepare<
          [],
          {
            id: string;
            name: string | null;
            room_id: string | null;
            checkin_time: number;
            created_at: number;
          }
        >(
          `SELECT id, name, room_id, checkin_time, created_at
           FROM guests
           WHERE active = 1
           ORDER BY checkin_time DESC`,
        )
        .all();

      const enriched = guests.map((g) => ({
        id: g.id,
        name: g.name,
        roomId: g.room_id,
        room: g.room_id ? deviceRegistry.getRoom(g.room_id) : null,
        checkinTime: g.checkin_time,
        createdAt: g.created_at,
      }));

      return ok(reply, { items: enriched, total: enriched.length });
    },
  );

  /**
   * GET /guest/:id
   * Get a specific guest record.
   */
  fastify.get<{ Params: { id: string } }>(
    "/guest/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const db = getDb();

      const guest = db
        .prepare<
          [string],
          {
            id: string;
            name: string | null;
            room_id: string | null;
            checkin_time: number;
            checkout_time: number | null;
            active: number;
            created_at: number;
          }
        >(
          `SELECT id, name, room_id, checkin_time, checkout_time, active, created_at
           FROM guests WHERE id = ?`,
        )
        .get(request.params.id);

      if (!guest) {
        return fail(
          reply,
          404,
          `Guest not found: ${request.params.id}`,
          "GUEST_NOT_FOUND",
        );
      }

      return ok(reply, {
        id: guest.id,
        name: guest.name,
        roomId: guest.room_id,
        room: guest.room_id ? deviceRegistry.getRoom(guest.room_id) : null,
        checkinTime: guest.checkin_time,
        checkoutTime: guest.checkout_time,
        active: guest.active === 1,
        createdAt: guest.created_at,
      });
    },
  );

  // ════════════════════════════════════════════════════════════════════════════
  // SCHEDULES
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * GET /schedules
   * List all schedules.
   */
  fastify.get(
    "/schedules",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const querySchema = z.object({
        enabled: z.enum(["true", "false"]).optional(),
      });
      const query = querySchema.safeParse(request.query);
      const onlyEnabled = query.success && query.data.enabled === "true";

      const schedules = scheduler.listSchedules(onlyEnabled);
      return ok(reply, { items: schedules, total: schedules.length });
    },
  );

  /**
   * GET /schedules/:id
   * Get a single schedule.
   */
  fastify.get<{ Params: { id: string } }>(
    "/schedules/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const s = scheduler.getSchedule(request.params.id);
      if (!s) {
        return fail(
          reply,
          404,
          `Schedule not found: ${request.params.id}`,
          "SCHEDULE_NOT_FOUND",
        );
      }
      return ok(reply, s);
    },
  );

  /**
   * POST /schedules
   * Create a new schedule.
   *
   * Example:
   *   {
   *     "name": "Morning lights",
   *     "roomId": "uuid",
   *     "action": { "state": "ON" },
   *     "runAt": 1712007200,
   *     "repeatCron": "0 7 * * *"
   *   }
   */
  fastify.post(
    "/schedules",
    { preHandler: [requireAuth, requireRole("admin", "operator")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = parseBody(CreateScheduleSchema, request.body, reply);
      if (parsed.error) return;

      const { name, deviceId, roomId, action, runAt, repeatCron } = parsed.data;

      // Validate that runAt is in the future (for one-shot schedules)
      const nowSec = Math.floor(Date.now() / 1000);
      if (!repeatCron && runAt <= nowSec) {
        return fail(
          reply,
          400,
          "runAt must be a future Unix epoch timestamp for one-shot schedules",
          "SCHEDULE_IN_PAST",
        );
      }

      // Validate device/room existence
      if (deviceId && !deviceRegistry.isKnownDevice(deviceId)) {
        return fail(
          reply,
          404,
          `Device not found: ${deviceId}`,
          "DEVICE_NOT_FOUND",
        );
      }
      if (roomId && !deviceRegistry.getRoom(roomId)) {
        return fail(reply, 404, `Room not found: ${roomId}`, "ROOM_NOT_FOUND");
      }
      if (!deviceId && !roomId) {
        return fail(
          reply,
          400,
          "Either deviceId or roomId must be provided",
          "MISSING_TARGET",
        );
      }

      try {
        const schedule = scheduler.createSchedule({
          name,
          deviceId,
          roomId,
          action,
          runAt,
          repeatCron,
        });

        log.info(
          {
            scheduleId: schedule.id,
            name,
            runAt,
            repeatCron,
            userId: request.authUser?.id,
          },
          "Schedule created via API",
        );

        return ok(reply, schedule, 201);
      } catch (err) {
        log.error({ err }, "Failed to create schedule");
        return fail(reply, 500, "Failed to create schedule", "INTERNAL_ERROR");
      }
    },
  );

  /**
   * PATCH /schedules/:id
   * Update an existing schedule.
   */
  fastify.patch<{ Params: { id: string } }>(
    "/schedules/:id",
    { preHandler: [requireAuth, requireRole("admin", "operator")] },
    async (request, reply) => {
      const existing = scheduler.getSchedule(request.params.id);
      if (!existing) {
        return fail(
          reply,
          404,
          `Schedule not found: ${request.params.id}`,
          "SCHEDULE_NOT_FOUND",
        );
      }

      const parsed = parseBody(UpdateScheduleSchema, request.body, reply);
      if (parsed.error) return;

      try {
        const updated = scheduler.updateSchedule(
          request.params.id,
          parsed.data,
        );
        return ok(reply, updated);
      } catch (err) {
        log.error(
          { err, scheduleId: request.params.id },
          "Failed to update schedule",
        );
        return fail(reply, 500, "Failed to update schedule", "INTERNAL_ERROR");
      }
    },
  );

  /**
   * DELETE /schedules/:id
   * Delete a schedule.
   */
  fastify.delete<{ Params: { id: string } }>(
    "/schedules/:id",
    { preHandler: [requireAuth, requireRole("admin", "operator")] },
    async (request, reply) => {
      const existing = scheduler.getSchedule(request.params.id);
      if (!existing) {
        return fail(
          reply,
          404,
          `Schedule not found: ${request.params.id}`,
          "SCHEDULE_NOT_FOUND",
        );
      }

      scheduler.deleteSchedule(request.params.id);
      return ok(reply, { scheduleId: request.params.id, deleted: true });
    },
  );

  // ════════════════════════════════════════════════════════════════════════════
  // AUTOMATIONS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * GET /automations
   * List all automation rules.
   */
  fastify.get(
    "/automations",
    { preHandler: [requireAuth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const automations = automationEngine.listAutomations();
      return ok(reply, { items: automations, total: automations.length });
    },
  );

  /**
   * GET /automations/:id
   * Get a single automation rule.
   */
  fastify.get<{ Params: { id: string } }>(
    "/automations/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const automation = automationEngine.getAutomation(request.params.id);
      if (!automation) {
        return fail(
          reply,
          404,
          `Automation not found: ${request.params.id}`,
          "AUTOMATION_NOT_FOUND",
        );
      }
      return ok(reply, automation);
    },
  );

  /**
   * POST /automations
   * Create a new automation rule.
   *
   * Example — turn on all room devices when a guest checks in:
   *   {
   *     "name": "Guest checkin - Room 101",
   *     "trigger": { "type": "guest_checkin", "roomId": "uuid" },
   *     "actions": [
   *       { "type": "set_room_state", "roomId": "uuid", "state": "ON" }
   *     ]
   *   }
   */
  fastify.post(
    "/automations",
    { preHandler: [requireAuth, requireRole("admin", "operator")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = parseBody(CreateAutomationSchema, request.body, reply);
      if (parsed.error) return;

      const { name, trigger, actions } = parsed.data;

      try {
        const automation = automationEngine.createAutomation({
          name,
          trigger,
          actions,
        });

        log.info(
          {
            automationId: automation.id,
            name,
            triggerType: trigger.type,
            userId: request.authUser?.id,
          },
          "Automation created via API",
        );

        return ok(reply, automation, 201);
      } catch (err) {
        log.error({ err }, "Failed to create automation");
        return fail(
          reply,
          500,
          "Failed to create automation",
          "INTERNAL_ERROR",
        );
      }
    },
  );

  /**
   * PATCH /automations/:id
   * Update an existing automation rule.
   */
  fastify.patch<{ Params: { id: string } }>(
    "/automations/:id",
    { preHandler: [requireAuth, requireRole("admin", "operator")] },
    async (request, reply) => {
      const existing = automationEngine.getAutomation(request.params.id);
      if (!existing) {
        return fail(
          reply,
          404,
          `Automation not found: ${request.params.id}`,
          "AUTOMATION_NOT_FOUND",
        );
      }

      const parsed = parseBody(UpdateAutomationSchema, request.body, reply);
      if (parsed.error) return;

      try {
        const updated = automationEngine.updateAutomation(
          request.params.id,
          parsed.data,
        );
        return ok(reply, updated);
      } catch (err) {
        log.error(
          { err, automationId: request.params.id },
          "Failed to update automation",
        );
        return fail(
          reply,
          500,
          "Failed to update automation",
          "INTERNAL_ERROR",
        );
      }
    },
  );

  /**
   * DELETE /automations/:id
   * Delete an automation rule.
   */
  fastify.delete<{ Params: { id: string } }>(
    "/automations/:id",
    { preHandler: [requireAuth, requireRole("admin", "operator")] },
    async (request, reply) => {
      const existing = automationEngine.getAutomation(request.params.id);
      if (!existing) {
        return fail(
          reply,
          404,
          `Automation not found: ${request.params.id}`,
          "AUTOMATION_NOT_FOUND",
        );
      }

      automationEngine.deleteAutomation(request.params.id);

      log.info(
        { automationId: request.params.id, userId: request.authUser?.id },
        "Automation deleted",
      );

      return ok(reply, { automationId: request.params.id, deleted: true });
    },
  );

  /**
   * POST /automations/:id/trigger
   * Manually trigger an automation rule (for testing / manual override).
   */
  fastify.post<{ Params: { id: string } }>(
    "/automations/:id/trigger",
    { preHandler: [requireAuth, requireRole("admin", "operator")] },
    async (request, reply) => {
      const automation = automationEngine.getAutomation(request.params.id);
      if (!automation) {
        return fail(
          reply,
          404,
          `Automation not found: ${request.params.id}`,
          "AUTOMATION_NOT_FOUND",
        );
      }

      if (!automation.enabled) {
        return fail(
          reply,
          422,
          "Automation is disabled",
          "AUTOMATION_DISABLED",
        );
      }

      // Emit a manual trigger via event bus — automation engine picks it up
      eventBus.emit(EventTypes.AUTOMATION_TRIGGERED, {
        automationId: automation.id,
        trigger: { type: "manual", triggeredBy: request.authUser?.id },
        actions: automation.actions as unknown as Array<
          Record<string, unknown>
        >,
        timestamp: Date.now(),
      });

      // Also directly execute the actions so they fire synchronously
      for (const action of automation.actions) {
        if (
          action.type === "set_device_state" &&
          action.deviceId &&
          action.state
        ) {
          stateManager.setDeviceState(
            action.deviceId,
            action.channel ?? 0,
            action.state,
            "automation",
          );
        } else if (
          action.type === "set_room_state" &&
          action.roomId &&
          action.state
        ) {
          stateManager.setRoomState(action.roomId, action.state, "automation");
        }
      }

      log.info(
        { automationId: automation.id, userId: request.authUser?.id },
        "Automation manually triggered via API",
      );

      return ok(reply, {
        automationId: automation.id,
        name: automation.name,
        triggered: true,
        actionsCount: automation.actions.length,
      });
    },
  );
}
