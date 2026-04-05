import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { verifyGoogleToken, requireAuth } from "../middleware/auth.js";
import { getDb } from "../../db/index.js";
import { createLogger } from "../../system/logger.js";
import { config } from "../../config/index.js";

const log = createLogger("api:auth");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok<T>(reply: FastifyReply, data: T, statusCode = 200) {
  return reply.status(statusCode).send({ ok: true, data });
}

function fail(
  reply: FastifyReply,
  statusCode: number,
  message: string,
  code = "ERROR",
) {
  return reply.status(statusCode).send({ ok: false, error: { message, code } });
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function authRoutes(fastify: FastifyInstance): Promise<void> {

  /**
   * POST /auth/google
   *
   * Exchange a Google ID token (obtained client-side via Google Sign-In SDK)
   * for a hub-issued JWT. The JWT is then used as a Bearer token on all
   * subsequent API calls.
   *
   * Flow:
   *   1. Client obtains a Google ID token via the Google Sign-In JS library.
   *   2. Client POSTs { idToken } here.
   *   3. Hub verifies the token with Google's servers.
   *   4. Hub upserts the user in the local DB.
   *   5. Hub returns a signed JWT.
   *
   * Role assignment:
   *   - The very first user to log in is automatically granted the "admin" role.
   *   - All subsequent users start as "viewer" and must be promoted by an admin.
   */
  fastify.post(
    "/auth/google",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const schema = z.object({
        idToken: z.string().min(1, "Google ID token is required"),
      });

      const result = schema.safeParse(request.body);
      if (!result.success) {
        return fail(
          reply,
          400,
          result.error.errors.map((e) => e.message).join("; "),
          "VALIDATION_ERROR",
        );
      }

      const { idToken } = result.data;

      // ── 1. Check OAuth is configured ───────────────────────────────────────
      if (!config.auth.googleClientId) {
        log.warn("Google OAuth not configured (GOOGLE_CLIENT_ID not set)");
        return fail(
          reply,
          503,
          "Google OAuth is not configured on this hub",
          "OAUTH_NOT_CONFIGURED",
        );
      }

      // ── 2. Verify with Google ──────────────────────────────────────────────
      const googleUser = await verifyGoogleToken(idToken);
      if (!googleUser) {
        return fail(
          reply,
          401,
          "Invalid or expired Google ID token",
          "INVALID_GOOGLE_TOKEN",
        );
      }

      log.info(
        { sub: googleUser.sub, email: googleUser.email },
        "Google token verified",
      );

      // ── 3. Upsert user in DB ───────────────────────────────────────────────
      const db     = getDb();
      const nowSec = Math.floor(Date.now() / 1000);

      // First user ever → admin; everyone else starts as viewer
      const { count } = db
        .prepare<[], { count: number }>("SELECT COUNT(*) as count FROM users")
        .get()!;
      const isFirstUser = count === 0;

      db.prepare(`
        INSERT INTO users (id, email, name, picture, role, created_at, last_login)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          email      = excluded.email,
          name       = excluded.name,
          picture    = excluded.picture,
          last_login = excluded.last_login
      `).run(
        googleUser.sub,
        googleUser.email,
        googleUser.name    ?? null,
        googleUser.picture ?? null,
        isFirstUser ? "admin" : "viewer",
        nowSec,
        nowSec,
      );

      // Fetch the final record (role may have been set in a prior login)
      const user = db
        .prepare<[string], { id: string; email: string; name: string | null; role: string }>(
          "SELECT id, email, name, role FROM users WHERE id = ?",
        )
        .get(googleUser.sub);

      if (!user) {
        log.error({ sub: googleUser.sub }, "User not found after upsert");
        return fail(reply, 500, "Failed to create or retrieve user", "INTERNAL_ERROR");
      }

      // ── 4. Issue JWT ───────────────────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const token = (fastify as any).jwt.sign(
        { sub: user.id, email: user.email, role: user.role },
        { expiresIn: config.auth.jwtExpiry },
      );

      log.info(
        { userId: user.id, email: user.email, role: user.role, isFirstUser },
        "User authenticated — JWT issued",
      );

      return ok(reply, {
        token,
        user:      { id: user.id, email: user.email, name: user.name, role: user.role },
        expiresIn: config.auth.jwtExpiry,
      });
    },
  );

  /**
   * GET /auth/me
   * Return the current user's full profile.
   */
  fastify.get(
    "/auth/me",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.authUser!;
      const db     = getDb();

      const full = db
        .prepare<
          [string],
          {
            id: string;
            email: string;
            name: string | null;
            picture: string | null;
            role: string;
            created_at: number;
            last_login: number | null;
          }
        >("SELECT id, email, name, picture, role, created_at, last_login FROM users WHERE id = ?")
        .get(id);

      if (!full) return fail(reply, 404, "User not found", "USER_NOT_FOUND");

      return ok(reply, {
        id:        full.id,
        email:     full.email,
        name:      full.name,
        picture:   full.picture,
        role:      full.role,
        createdAt: full.created_at,
        lastLogin: full.last_login,
      });
    },
  );

  /**
   * PATCH /auth/me
   * Update the current user's own profile (name only).
   */
  fastify.patch(
    "/auth/me",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const schema = z.object({
        name: z.string().min(1).max(128).optional(),
      });

      const result = schema.safeParse(request.body);
      if (!result.success) {
        return fail(reply, 400, "Invalid request body", "VALIDATION_ERROR");
      }

      const { id } = request.authUser!;
      const db     = getDb();

      if (result.data.name !== undefined) {
        db.prepare("UPDATE users SET name = ? WHERE id = ?").run(
          result.data.name,
          id,
        );
      }

      const updated = db
        .prepare<[string], { id: string; email: string; name: string | null; role: string }>(
          "SELECT id, email, name, role FROM users WHERE id = ?",
        )
        .get(id);

      return ok(reply, updated);
    },
  );

  /**
   * POST /auth/logout
   * JWTs are stateless so logout is handled client-side (discard the token).
   * This endpoint exists for future token-revocation support and audit logging.
   */
  fastify.post(
    "/auth/logout",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      log.info({ userId: request.authUser?.id }, "User logged out");
      return ok(reply, { message: "Logged out. Discard your token client-side." });
    },
  );

  /**
   * GET /auth/users
   * List all users. Admin only.
   */
  fastify.get(
    "/auth/users",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.authUser?.role !== "admin") {
        return fail(reply, 403, "Admin access required", "FORBIDDEN");
      }

      const db    = getDb();
      const users = db
        .prepare<
          [],
          {
            id: string;
            email: string;
            name: string | null;
            role: string;
            created_at: number;
            last_login: number | null;
          }
        >("SELECT id, email, name, role, created_at, last_login FROM users ORDER BY created_at ASC")
        .all();

      return ok(reply, { items: users, total: users.length });
    },
  );

  /**
   * PATCH /auth/users/:id/role
   * Change a user's role. Admin only.
   * An admin cannot demote themselves.
   */
  fastify.patch<{ Params: { id: string } }>(
    "/auth/users/:id/role",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (request.authUser?.role !== "admin") {
        return fail(reply, 403, "Admin access required", "FORBIDDEN");
      }

      const schema = z.object({
        role: z.enum(["admin", "operator", "viewer"]),
      });

      const result = schema.safeParse(request.body);
      if (!result.success) {
        return fail(reply, 400, "Invalid role", "VALIDATION_ERROR");
      }

      const { id: targetId } = request.params;

      if (targetId === request.authUser.id && result.data.role !== "admin") {
        return fail(reply, 400, "You cannot demote yourself from admin", "SELF_DEMOTION");
      }

      const db     = getDb();
      const target = db
        .prepare<[string], { id: string }>("SELECT id FROM users WHERE id = ?")
        .get(targetId);

      if (!target) return fail(reply, 404, "User not found", "USER_NOT_FOUND");

      db.prepare("UPDATE users SET role = ? WHERE id = ?").run(
        result.data.role,
        targetId,
      );

      log.info(
        { adminId: request.authUser.id, targetId, newRole: result.data.role },
        "User role updated",
      );

      return ok(reply, { id: targetId, role: result.data.role });
    },
  );
}
