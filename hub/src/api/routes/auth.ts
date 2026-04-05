import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { verifyGoogleToken, requireAuth } from "../middleware/auth.js";
import { getDb } from "../../db/index.js";
import { createLogger } from "../../system/logger.js";
import { config } from "../../config/index.js";

const log = createLogger("api:auth");

// ─── Validation Schemas ───────────────────────────────────────────────────────

const GoogleLoginSchema = z.object({
  idToken: z.string().min(1, "Google ID token is required"),
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

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /auth/google
   *
   * Exchange a Google ID token (obtained client-side via Google Sign-In)
   * for a hub-issued JWT session token.
   *
   * Flow:
   *   1. Client gets Google ID token via Google Sign-In
   *   2. Client POSTs idToken here
   *   3. Hub verifies token with Google
   *   4. Hub upserts user in DB
   *   5. Hub returns signed JWT
   *
   * The returned JWT is used as a Bearer token for all subsequent API calls.
   */
  fastify.post(
    "/auth/google",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const result = GoogleLoginSchema.safeParse(request.body);
      if (!result.success) {
        return fail(
          reply,
          400,
          result.error.errors.map((e) => e.message).join("; "),
          "VALIDATION_ERROR",
        );
      }

      const { idToken } = result.data;

      // ── 1. Verify with Google ─────────────────────────────────────────────
      if (!config.auth.googleClientId) {
        log.warn("Google OAuth is not configured (GOOGLE_CLIENT_ID not set)");
        return fail(
          reply,
          503,
          "Google OAuth is not configured on this hub",
          "OAUTH_NOT_CONFIGURED",
        );
      }

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

      // ── 2. Upsert user in DB ──────────────────────────────────────────────
      const db = getDb();
      const nowSec = Math.floor(Date.now() / 1000);

      // Check if this is the very first user — make them admin
      const existingCount = db
        .prepare<[], { count: number }>("SELECT COUNT(*) as count FROM users")
        .get();
      const isFirstUser = (existingCount?.count ?? 0) === 0;

      db.prepare(
        `
        INSERT INTO users (id, email, name, picture, role, created_at, last_login)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          email      = excluded.email,
          name       = excluded.name,
          picture    = excluded.picture,
          last_login = excluded.last_login
      `,
      ).run(
        googleUser.sub,
        googleUser.email,
        googleUser.name ?? null,
        googleUser.picture ?? null,
        isFirstUser ? "admin" : "viewer", // First user gets admin; subsequent users get viewer
        nowSec,
        nowSec,
      );

      // Fetch the final user record (role may have been set previously)
      const user = db
        .prepare<
          [string],
          { id: string; email: string; name: string | null; role: string }
        >(
          `
          SELECT id, email, name, role FROM users WHERE id = ?
        `,
        )
        .get(googleUser.sub);

      if (!user) {
        log.error(
          { sub: googleUser.sub },
          "User not found after upsert — unexpected",
        );
        return fail(
          reply,
          500,
          "Failed to create or retrieve user",
          "INTERNAL_ERROR",
        );
      }

      // ── 3. Issue JWT ──────────────────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const token = (fastify as any).jwt.sign(
        {
          sub: user.id,
          email: user.email,
          role: user.role,
        },
        { expiresIn: config.auth.jwtExpiry },
      );

      log.info(
        { userId: user.id, email: user.email, role: user.role, isFirstUser },
        "User authenticated — JWT issued",
      );

      return ok(reply, {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        expiresIn: config.auth.jwtExpiry,
      });
    },
  );

  /**
   * GET /auth/me
   * Return the currently authenticated user's profile.
   */
  fastify.get(
    "/auth/me",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.authUser!;

      const db = getDb();
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
        .get(user.id);

      if (!full) {
        return fail(reply, 404, "User not found", "USER_NOT_FOUND");
      }

      return ok(reply, {
        id: full.id,
        email: full.email,
        name: full.name,
        picture: full.picture,
        role: full.role,
        createdAt: full.created_at,
        lastLogin: full.last_login,
      });
    },
  );

  /**
   * PATCH /auth/me
   * Update the current user's own profile (name only for now).
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

      const user = request.authUser!;
      const db = getDb();

      if (result.data.name !== undefined) {
        db.prepare("UPDATE users SET name = ? WHERE id = ?").run(
          result.data.name,
          user.id,
        );
      }

      const updated = db
        .prepare<
          [string],
          { id: string; email: string; name: string | null; role: string }
        >("SELECT id, email, name, role FROM users WHERE id = ?")
        .get(user.id);

      return ok(reply, updated);
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

      const db = getDb();
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
   */
  fastify.patch<{ Params: { id: string } }>(
    "/auth/users/:id/role",
    { preHandler: [requireAuth] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
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

      const targetId = request.params.id;

      // Prevent self-demotion
      if (targetId === request.authUser!.id && result.data.role !== "admin") {
        return fail(
          reply,
          400,
          "You cannot demote yourself from admin",
          "SELF_DEMOTION",
        );
      }

      const db = getDb();
      const target = db
        .prepare<[string], { id: string }>("SELECT id FROM users WHERE id = ?")
        .get(targetId);

      if (!target) {
        return fail(reply, 404, "User not found", "USER_NOT_FOUND");
      }

      db.prepare("UPDATE users SET role = ? WHERE id = ?").run(
        result.data.role,
        targetId,
      );

      log.info(
        { adminId: request.authUser!.id, targetId, newRole: result.data.role },
        "User role updated",
      );

      return ok(reply, { id: targetId, role: result.data.role });
    },
  );

  /**
   * POST /auth/logout
   * Stateless JWT — logout is handled client-side by discarding the token.
   * This endpoint exists for future revocation list support.
   */
  fastify.post(
    "/auth/logout",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      log.info({ userId: request.authUser?.id }, "User logged out");
      // In the future: add token to a revocation list stored in DB
      return ok(reply, {
        message: "Logged out. Discard your token client-side.",
      });
    },
  );
}
