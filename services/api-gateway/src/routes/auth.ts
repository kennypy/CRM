import type { FastifyInstance } from "fastify";
import { z } from "zod";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function authRoutes(fastify: FastifyInstance) {
  // POST /auth/login
  fastify.post("/login", async (request, reply) => {
    const body = LoginSchema.parse(request.body);
    // TODO: proxy to auth service
    const token = await fastify.jwt.sign({
      sub: "user-placeholder-id",
      tenantId: "tenant-placeholder-id",
      email: body.email,
      role: "rep",
      scopes: ["crm:read", "crm:write", "ai:read"],
    });
    return reply.send({ success: true, data: { accessToken: token } });
  });

  // POST /auth/refresh
  fastify.post("/refresh", async (request, reply) => {
    // TODO: validate refresh token and issue new access token
    return reply.send({ success: true, data: { accessToken: "new-token" } });
  });

  // POST /auth/logout
  fastify.post("/logout", async (request, reply) => {
    // TODO: invalidate refresh token
    return reply.send({ success: true });
  });

  // GET /auth/me
  fastify.get("/me", async (request, reply) => {
    // Auth middleware runs first; JWT is verified
    return reply.send({ success: true, data: (request as any).user });
  });

  // GET /auth/oauth/google — redirect to Google
  fastify.get("/oauth/google", async (request, reply) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.GOOGLE_REDIRECT_URI ?? "");
    const scope = encodeURIComponent("openid email profile");
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&access_type=offline`;
    return reply.redirect(url);
  });
}
