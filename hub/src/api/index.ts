import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import staticFiles from "@fastify/static";
import * as path from "path";
import * as fs from "fs";
import { config } from "../config/index.js";
import { createLogger } from "../system/logger.js";
import { devicesRoutes } from "./routes/devices.js";
import { authRoutes } from "./routes/auth.js";
import { guestsRoutes } from "./routes/guests.js";
import { healthRoutes } from "./routes/health.js";
import { provisionRoutes } from "./routes/provision.js";
import { mcpRoutes } from "../mcp/index.js";

const log = createLogger("api");

// ─── Server Factory ───────────────────────────────────────────────────────────

export async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: false, // We use our own pino logger
    trustProxy: true,
    disableRequestLogging: false,
    requestIdHeader: "x-request-id",
    requestIdLogLabel: "reqId",
    genReqId: () => Math.random().toString(36).slice(2, 10),
  });

  // ── Request / Response Logging ────────────────────────────────────────────────

  fastify.addHook("onRequest", async (request) => {
    log.debug(
      { method: request.method, url: request.url, ip: request.ip },
      "Incoming request",
    );
  });

  fastify.addHook("onResponse", async (request, reply) => {
    const level =
      reply.statusCode >= 500
        ? "error"
        : reply.statusCode >= 400
          ? "warn"
          : "debug";

    log[level](
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: `${reply.elapsedTime.toFixed(2)}ms`,
      },
      "Request completed",
    );
  });

  // ── CORS ──────────────────────────────────────────────────────────────────────
  // In demo / SKIP_AUTH mode we allow all origins so the PWA (served from a
  // different port or an ngrok URL) can freely call the hub API.

  const skipAuth = process.env.SKIP_AUTH === "true";

  await fastify.register(cors, {
    origin: skipAuth ? true : config.server.isDev ? true : config.cors.origins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-API-Key",
      "X-Request-Id",
    ],
    credentials: true,
    maxAge: 86400, // 24 h preflight cache
  });

  // ── JWT ───────────────────────────────────────────────────────────────────────

  await fastify.register(jwt, {
    secret: config.auth.jwtSecret,
    sign: { expiresIn: config.auth.jwtExpiry },
    verify: {
      extractToken: (request) => {
        const authHeader = request.headers.authorization;
        if (authHeader?.startsWith("Bearer ")) {
          return authHeader.slice(7);
        }
        // Also support ?token= query param for convenience
        const query = request.query as Record<string, string>;
        return query["token"] ?? undefined;
      },
    },
  });

  // ── Static File Serving (Dashboard PWA) ──────────────────────────────────────
  // The built Next.js / Vite dashboard is served from the hub so the phone only
  // needs one address.  We look for the build output in a few candidate paths
  // relative to the current working directory.

  const staticCandidates = [
    path.resolve(process.cwd(), "../dashboard/.next/standalone"),
    path.resolve(process.cwd(), "../dashboard/out"),
    path.resolve(process.cwd(), "../dashboard/dist"),
    path.resolve(process.cwd(), "public"),
  ];

  const staticRoot = staticCandidates.find((p) => fs.existsSync(p));

  if (staticRoot) {
    log.info({ staticRoot }, "Serving dashboard static files");

    await fastify.register(staticFiles, {
      root: staticRoot,
      prefix: "/app/",
      decorateReply: false,
    });
  } else {
    log.warn(
      { candidates: staticCandidates },
      "No dashboard build found — skipping static file serving. Run `pnpm build` in dashboard/.",
    );
  }

  // ── Global Error Handler ──────────────────────────────────────────────────────

  fastify.setErrorHandler((error, request, reply) => {
    log.error(
      {
        err: error,
        method: request.method,
        url: request.url,
        body: config.server.isDev ? request.body : undefined,
      },
      "Unhandled request error",
    );

    // Fastify schema-validation errors
    if (error.validation) {
      return reply.status(400).send({
        ok: false,
        error: {
          message: "Validation error",
          code: "VALIDATION_ERROR",
          details: error.validation,
        },
      });
    }

    // JWT-specific errors
    if (error.code === "FST_JWT_AUTHORIZATION_TOKEN_EXPIRED") {
      return reply.status(401).send({
        ok: false,
        error: { message: "Token expired", code: "TOKEN_EXPIRED" },
      });
    }

    if (
      error.code === "FST_JWT_NO_AUTHORIZATION_IN_HEADER" ||
      error.code === "FST_JWT_AUTHORIZATION_TOKEN_INVALID"
    ) {
      return reply.status(401).send({
        ok: false,
        error: { message: "Invalid token", code: "INVALID_TOKEN" },
      });
    }

    const statusCode = error.statusCode ?? 500;

    return reply.status(statusCode).send({
      ok: false,
      error: {
        message: statusCode >= 500 ? "Internal server error" : error.message,
        code: statusCode >= 500 ? "INTERNAL_ERROR" : (error.code ?? "ERROR"),
        // Only expose stack traces in development
        stack: config.server.isDev ? error.stack : undefined,
      },
    });
  });

  // ── 404 Handler ───────────────────────────────────────────────────────────────

  fastify.setNotFoundHandler((request, reply) => {
    log.debug({ method: request.method, url: request.url }, "404 not found");
    return reply.status(404).send({
      ok: false,
      error: {
        message: `Route ${request.method} ${request.url} not found`,
        code: "NOT_FOUND",
      },
    });
  });

  // ── Routes ────────────────────────────────────────────────────────────────────

  // Health + auth routes at the root (no /api/v1 prefix)
  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);

  // Provisioning routes — no auth required (called during ESP setup)
  await fastify.register(provisionRoutes, { prefix: "/api/v1" });

  // API routes under /api/v1
  await fastify.register(
    async (api) => {
      await api.register(devicesRoutes);
      await api.register(guestsRoutes);
    },
    { prefix: "/api/v1" },
  );

  // MCP tool server
  await fastify.register(mcpRoutes);

  log.info("Fastify server built — all routes registered");

  return fastify;
}

// ─── Start ────────────────────────────────────────────────────────────────────

export async function startServer(fastify: FastifyInstance): Promise<void> {
  const { port, host } = config.server;

  await fastify.listen({ port, host });

  log.info(
    { port, host, env: config.server.nodeEnv },
    `🚀 Zapp Hub listening on http://${host}:${port}`,
  );
}
