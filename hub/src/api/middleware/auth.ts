import { FastifyRequest, FastifyReply } from "fastify";
import { OAuth2Client } from "google-auth-library";
import { config } from "../../config/index.js";
import { createLogger } from "../../system/logger.js";
import { getDb, DbUser } from "../../db/index.js";

const log = createLogger("auth-middleware");
const googleClient = new OAuth2Client(config.auth.googleClientId);

// ─── JWT Type Augmentation ────────────────────────────────────────────────────
// Tell @fastify/jwt what shape our JWT payload and decoded user have.

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      email: string;
      role: "admin" | "operator" | "viewer";
    };
    user: {
      sub: string;
      email: string;
      role: "admin" | "operator" | "viewer";
    };
  }
}

// ─── Authenticated User (resolved from DB after token verification) ───────────

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "operator" | "viewer";
}

// Attach the resolved user to the request object under a non-conflicting key.
declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthenticatedUser;
  }
}

// ─── Google Token Verification ────────────────────────────────────────────────

export async function verifyGoogleToken(idToken: string): Promise<{
  sub: string;
  email: string;
  name?: string;
  picture?: string;
} | null> {
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: config.auth.googleClientId,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      return null;
    }

    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };
  } catch (err) {
    log.warn({ err }, "Google token verification failed");
    return null;
  }
}

// ─── JWT Auth Hook ────────────────────────────────────────────────────────────

/**
 * Fastify preHandler hook that validates the Bearer JWT token.
 * Attaches the resolved DB user to request.authUser.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    log.warn({ url: request.url }, "Missing or malformed Authorization header");
    return reply.status(401).send({
      error: "Unauthorized",
      message: "Missing Bearer token",
    });
  }

  try {
    await request.jwtVerify();

    const decoded = request.user;

    // Load user from DB to ensure they still exist and get current role
    const db = getDb();
    const user = db
      .prepare<
        [string],
        DbUser
      >("SELECT id, email, name, role, created_at, last_login FROM users WHERE id = ?")
      .get(decoded.sub);

    if (!user) {
      log.warn({ sub: decoded.sub }, "JWT valid but user not found in DB");
      return reply.status(401).send({
        error: "Unauthorized",
        message: "User not found",
      });
    }

    request.authUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    log.debug(
      { userId: user.id, role: user.role, url: request.url },
      "Request authenticated",
    );
  } catch (err) {
    log.warn({ err, url: request.url }, "JWT verification failed");
    return reply.status(401).send({
      error: "Unauthorized",
      message: "Invalid or expired token",
    });
  }
}

/**
 * Require the authenticated user to have one of the specified roles.
 * Must be used after requireAuth.
 */
export function requireRole(...roles: Array<"admin" | "operator" | "viewer">) {
  return async function (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (!request.authUser) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Authentication required",
      });
    }

    if (!roles.includes(request.authUser.role)) {
      log.warn(
        {
          userId: request.authUser.id,
          userRole: request.authUser.role,
          requiredRoles: roles,
        },
        "Access denied: insufficient role",
      );
      return reply.status(403).send({
        error: "Forbidden",
        message: `Required role: ${roles.join(" or ")}`,
      });
    }
  };
}

/**
 * Optional auth — attaches user if token is valid, but does not block
 * unauthenticated requests.
 */
export async function optionalAuth(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) return;

  try {
    await request.jwtVerify();
    const decoded = request.user;

    const db = getDb();
    const user = db
      .prepare<
        [string],
        DbUser
      >("SELECT id, email, name, role FROM users WHERE id = ?")
      .get(decoded.sub);

    if (user) {
      request.authUser = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      };
    }
  } catch {
    // Silently ignore invalid tokens in optional auth
  }
}

/**
 * MCP API key auth — validates the static MCP_API_KEY for LLM tool requests.
 */
export async function requireMcpApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!config.mcp.enabled) {
    return reply.status(403).send({
      error: "Forbidden",
      message: "MCP interface is disabled",
    });
  }

  const apiKey =
    (request.headers["x-api-key"] as string | undefined) ??
    request.headers["authorization"]?.replace(/^Bearer /, "") ??
    "";

  if (!config.mcp.apiKey || apiKey !== config.mcp.apiKey) {
    log.warn({ url: request.url, ip: request.ip }, "Invalid MCP API key");
    return reply.status(401).send({
      error: "Unauthorized",
      message: "Invalid API key",
    });
  }
}
