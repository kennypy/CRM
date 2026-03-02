import type { FastifyInstance } from "fastify";

export async function integrationsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/integrations — list connected integrations for tenant
  fastify.get("/", async (_, reply) =>
    reply.send({ success: true, data: [] })
  );

  // Gmail OAuth flow
  fastify.get("/gmail/connect", async (request, reply) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.GMAIL_OAUTH_REDIRECT ?? "");
    const scope = encodeURIComponent("https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly");
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
    return reply.redirect(url);
  });

  fastify.get("/gmail/callback", async (request, reply) => {
    const { code } = request.query as { code: string };
    // TODO: exchange code for tokens, store in DB, start Gmail watch
    return reply.redirect("/settings/integrations?connected=gmail");
  });

  // Outlook OAuth flow
  fastify.get("/outlook/connect", async (request, reply) => {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.OUTLOOK_OAUTH_REDIRECT ?? "");
    const scope = encodeURIComponent("https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Calendars.Read offline_access");
    const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
    return reply.redirect(url);
  });

  fastify.get("/outlook/callback", async (request, reply) => {
    const { code } = request.query as { code: string };
    // TODO: exchange code for tokens, store in DB, start subscription
    return reply.redirect("/settings/integrations?connected=outlook");
  });
}
