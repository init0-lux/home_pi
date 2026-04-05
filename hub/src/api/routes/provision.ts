import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import * as os from "os";
import { config } from "../../config/index.js";
import { createLogger } from "../../system/logger.js";
import { deviceRegistry } from "../../core/device-registry.js";

const log = createLogger("api:provision");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok<T>(reply: FastifyReply, data: T, statusCode = 200) {
  return reply.status(statusCode).send({ ok: true, data });
}

/**
 * Get the primary non-loopback IPv4 address of this machine.
 * Used so the ESP can be told which IP to connect its MQTT client to.
 */
function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();

  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }

  return "127.0.0.1";
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function provisionRoutes(fastify: FastifyInstance): Promise<void> {

  /**
   * GET /provision/config
   *
   * No authentication required — this endpoint is called by the PWA while it
   * is still on the home WiFi network, BEFORE the user switches their phone to
   * the ESP's provisioning hotspot.
   *
   * The PWA stores the returned MQTT/hub details in localStorage so that when
   * the phone is disconnected from the hub (switched to the ESP hotspot), it
   * can still include the correct hub address in the payload it POSTs to the
   * ESP at http://192.168.4.1/configure.
   */
  fastify.get(
    "/provision/config",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const localIp = getLocalIpAddress();
      const hubUrl  = `http://${localIp}:${config.server.port}`;

      log.info({ localIp, mqttPort: config.mqtt.port, hubUrl }, "Provision config requested");

      return ok(reply, {
        mqttHost:   localIp,
        mqttPort:   config.mqtt.port,
        hubUrl,
        hubName:    config.hub.name,
        propertyId: config.hub.propertyId,
      });
    },
  );

  /**
   * GET /provision/rooms
   *
   * No authentication required — used by the provisioning wizard to populate
   * the room-assignment dropdown while the phone is still on the home network.
   */
  fastify.get(
    "/provision/rooms",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const rooms = deviceRegistry.listRooms();
      return ok(reply, { items: rooms, total: rooms.length });
    },
  );

  /**
   * POST /provision/rooms
   *
   * Create a room during the provisioning flow without requiring full auth.
   * Only name is required; propertyId defaults to the hub's configured value.
   */
  fastify.post(
    "/provision/rooms",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { name?: string };

      if (!body?.name || typeof body.name !== "string" || body.name.trim() === "") {
        return reply.status(400).send({
          ok: false,
          error: { message: "Room name is required", code: "VALIDATION_ERROR" },
        });
      }

      try {
        const room = deviceRegistry.createRoom({ name: body.name.trim() });
        log.info({ roomId: room.id, name: room.name }, "Room created via provisioning");
        return ok(reply, room, 201);
      } catch (err) {
        log.error({ err }, "Failed to create room during provisioning");
        return reply.status(500).send({
          ok: false,
          error: { message: "Failed to create room", code: "INTERNAL_ERROR" },
        });
      }
    },
  );

  /**
   * POST /provision/register
   *
   * Called by the ESP itself (or the PWA on its behalf) after the device has
   * joined the home WiFi and connected to the hub.  Idempotent — safe to call
   * on every boot.
   *
   * Body:
   *   { deviceId, roomId?, type?, name?, ipAddress? }
   */
  fastify.post(
    "/provision/register",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        deviceId?: string;
        roomId?: string;
        type?: string;
        name?: string;
        ipAddress?: string;
      };

      if (!body?.deviceId) {
        return reply.status(400).send({
          ok: false,
          error: { message: "deviceId is required", code: "VALIDATION_ERROR" },
        });
      }

      try {
        const device = deviceRegistry.registerDevice({
          deviceId:  body.deviceId,
          roomId:    body.roomId,
          type:      body.type ?? "relay",
          name:      body.name,
          ipAddress: body.ipAddress,
        });

        log.info(
          { deviceId: device.id, roomId: device.roomId },
          "Device registered via provisioning endpoint",
        );

        return ok(reply, device, 201);
      } catch (err) {
        log.error({ err }, "Failed to register device during provisioning");
        return reply.status(500).send({
          ok: false,
          error: { message: "Failed to register device", code: "INTERNAL_ERROR" },
        });
      }
    },
  );
}
