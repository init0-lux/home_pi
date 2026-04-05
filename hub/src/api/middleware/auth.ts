import { FastifyRequest, FastifyReply } from "fastify";
import { OAuth2Client } from "google-auth-library";
import { config } from "../../config/index.js";
import { createLogger } from "../../system/logger.js";
import { getDb, DbUser } from "../../db/index.js";

// ─── Demo / MVP Auth Bypass ───────────────────────────────────────────────────
// Set SKIP_AUTH=true in .env to disable authentication for local demos.
const SKIP_AUTH = process.env.SKIP_AUTH === "true";

const log = createLogger("auth-middleware");
const googleClient = new OAuth2Client(config.auth.googleClientId);

// ─── JWT Type Augmentation ────────────────────────────────────────────────────
// Tell @fastify/jwt the shape of our token payload and the decoded user object
// that request.user will hold after jwtVerify().

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

// ─── Resolved User ────────────────────────────────────────────────────────────
// After the JWT is verified we look the user up in the DB and attach this
// richer record to the request under a non-conflicting key (authUser).

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "operator" | "viewer";
}

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthenticatedUser;
  }
}

// ─── Google Token Verification ────────────────────────────────────────────────

export interface GoogleUserInfo {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

/**
 * Verify a Google ID token (obtained client-side via Google Sign-In) against
 * the hub's configured Google OAuth client ID.
 *
 * Returns the verified user info on success, or null on any failure.
 */
export async function verifyGoogleToken(
  idToken: string,
): Promise<GoogleUserInfo | null> {
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: config.auth.googleClientId,
    });

    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) return null;

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

// ─── requireAuth ─────────────────────────────────────────────────────────────

/**
 * Fastify preHandler hook that validates the Bearer JWT.
 *
 * On success: attaches the resolved DB user to `request.authUser`.
 * On failure: returns 401 immediately.
 *
 * Usage:
 *   fastify.get("/protected", { preHandler: [requireAuth] }, handler)
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // ── Demo bypass ────────────────────────────────────────────────────────────
  if (SKIP_AUTH) {
    request.authUser = {
      id: "demo-admin",
      email: "demo@zapp.local",
      name: "Demo Admin",
      role: "admin",
    };
    return;
  }

  const authHeader = request.headers["authorization"];

  if (!authHeader?.startsWith("Bearer ")) {
    log.warn({ url: request.url }, "Missing or malformed Authorization header");
    return reply.status(401).send({
      error: "Unauthorized",
      message: "Missing Bearer token",
    });
  }

  try {
    // jwtVerify() validates the signature & expiry and populates request.user
    // with the decoded payload (via the @fastify/jwt augmentation above).
    await request.jwtVerify();

    const decoded = request.user; // { sub, email, role }

    // Re-fetch from DB so we always use the latest role, and to ensure the
    // user has not been deleted since the token was issued.
    const db = getDb();
    const row = db
      .prepare<
        [string],
        DbUser
      >("SELECT id, email, name, role, created_at, last_login FROM users WHERE id = ?")
      .get(decoded.sub);

    if (!row) {
      log.warn({ sub: decoded.sub }, "JWT valid but user not found in DB");
      return reply.status(401).send({
        error: "Unauthorized",
        message: "User not found",
      });
    }

    request.authUser = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
    };

    log.debug(
      { userId: row.id, role: row.role, url: request.url },
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

// ─── requireRole ──────────────────────────────────────────────────────────────

/**
 * Fastify preHandler factory that enforces RBAC.
 * Must be placed **after** requireAuth in the preHandler chain.
 *
 * Usage:
 *   { preHandler: [requireAuth, requireRole("admin", "operator")] }
 */
export function requireRole(...roles: Array<"admin" | "operator" | "viewer">) {
  return async function (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (SKIP_AUTH) return; // demo bypass

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
          url: request.url,
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

// ─── optionalAuth ─────────────────────────────────────────────────────────────

/**
 * Like requireAuth but does NOT block unauthenticated requests.
 * Populates request.authUser when a valid token is present;
 * silently skips if no token or if the token is invalid.
 */
export async function optionalAuth(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) return;

  try {
    await request.jwtVerify();
    const decoded = request.user;

    const db = getDb();
    const row = db
      .prepare<
        [string],
        DbUser
      >("SELECT id, email, name, role FROM users WHERE id = ?")
      .get(decoded.sub);

    if (row) {
      request.authUser = {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
      };
    }
  } catch {
    // Silently ignore — optional auth never blocks
  }
}

// ─── requireMcpApiKey ─────────────────────────────────────────────────────────

/**
 * Validates the static pre-shared MCP API key for LLM tool requests.
 * Clients send it either as:
 *   X-API-Key: <key>
 *   Authorization: Bearer <key>
 *
 * This is intentionally separate from user JWT auth so that automated LLM
 * agents don't need to go through the Google OAuth flow.
 */
export async function requireMcpApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // ── Demo bypass ────────────────────────────────────────────────────────────
  if (SKIP_AUTH) return;

  if (!config.mcp.enabled) {
    return reply.status(403).send({
      error: "Forbidden",
      message: "MCP interface is disabled on this hub",
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
