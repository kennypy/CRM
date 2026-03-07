/**
 * Slack integration routes — OAuth, user mapping, and interactions.
 *
 * GET  /api/v1/integrations/slack/connect       — redirect to Slack OAuth
 * GET  /api/v1/integrations/slack/callback       — exchange code, store bot token
 * POST /api/v1/integrations/slack/interactions    — handle button clicks (public)
 * GET  /api/v1/integrations/slack/status          — connection status
 * GET  /api/v1/integrations/slack/users           — list mapped users
 * POST /api/v1/integrations/slack/users/sync      — auto-map by email
 * DELETE /api/v1/integrations/slack/disconnect     — remove Slack connection
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { FastifyInstance } from "fastify";
import { pool } from "../db";
import { requireRep, requireAdmin } from "../middleware/rbac";
import { exchangeSlackCode, encrypt } from "../lib/oauth-exchange";
import { listSlackUsers } from "../lib/slack-client";
import { handleCloseDateInteraction } from "../workers/close-date-handler";

function verifySlackRequest(rawBody: Buffer, timestamp: string, signature: string): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return false;

  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) return false;

  const sigBase = `v0:${timestamp}:${rawBody.toString("utf8")}`;
  const expected = "v0=" + createHmac("sha256", secret).update(sigBase).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(signature);

  return expectedBuf.length === receivedBuf.length && timingSafeEqual(expectedBuf, receivedBuf);
}

export async function slackRoutes(server: FastifyInstance) {
  // Need raw body for signature verification on interactions endpoint
  server.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "buffer" },
    (req, body: Buffer, done) => {
      try {
        (req as any).rawBody = body;
        const params = new URLSearchParams(body.toString("utf8"));
        const obj: Record<string, string> = {};
        params.forEach((v, k) => { obj[k] = v; });
        done(null, obj);
      } catch (err: any) {
        done(err, null);
      }
    }
  );

  // GET /connect — redirect to Slack OAuth
  server.get("/connect", { preHandler: [requireAdmin] }, async (request, reply) => {
    const clientId = process.env.SLACK_CLIENT_ID;
    if (!clientId) {
      return reply.status(500).send({ success: false, error: "Slack client ID not configured" });
    }

    const redirectUri = `${process.env.APP_URL ?? "http://localhost:4000"}/api/v1/integrations/slack/callback`;
    const scopes = "chat:write,users:read,users:read.email,channels:read,im:write";
    const state = request.user.tenantId;

    const url = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
    return reply.redirect(url);
  });

  // GET /callback — exchange code
  server.get("/callback", async (request, reply) => {
    const { code, state } = request.query as { code: string; state: string };
    const tenantId = state;
    const userId = request.user?.sub;

    if (!code || !tenantId) {
      return reply.redirect("/settings?slack=error&reason=missing_code");
    }

    try {
      const redirectUri = `${process.env.APP_URL ?? "http://localhost:4000"}/api/v1/integrations/slack/callback`;
      const result = await exchangeSlackCode(code, redirectUri);

      const encToken = encrypt(result.botToken);

      await pool.query(
        `INSERT INTO slack_workspaces
           (tenant_id, team_id, team_name, bot_token_enc, bot_user_id, installed_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, team_id)
         DO UPDATE SET bot_token_enc = $4, team_name = $3, updated_at = NOW()`,
        [tenantId, result.workspaceId, result.workspaceName, encToken, result.botUserId, userId]
      );

      return reply.redirect("/settings?tab=integrations&slack=connected");
    } catch (err: any) {
      server.log.error({ err: err.message }, "slack.oauth.error");
      return reply.redirect("/settings?tab=integrations&slack=error");
    }
  });

  // POST /interactions — handle Slack button clicks (public path)
  server.post("/interactions", async (request, reply) => {
    const rawBody = (request as any).rawBody as Buffer | undefined;
    const timestamp = request.headers["x-slack-request-timestamp"] as string | undefined;
    const signature = request.headers["x-slack-signature"] as string | undefined;

    if (!rawBody || !timestamp || !signature || !verifySlackRequest(rawBody, timestamp, signature)) {
      return reply.status(400).send({ error: "Invalid signature" });
    }

    const body = request.body as Record<string, string>;
    const payload = JSON.parse(body.payload ?? "{}");

    // Route to appropriate handler
    const actionId = payload.actions?.[0]?.action_id ?? "";
    if (actionId.startsWith("close_date_")) {
      await handleCloseDateInteraction(payload);
    }

    // Acknowledge immediately
    return reply.send();
  });

  // GET /status — connection status
  server.get("/status", { preHandler: [requireRep] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { rows } = await pool.query(
      `SELECT team_id, team_name, created_at, updated_at
       FROM slack_workspaces WHERE tenant_id = $1`,
      [tenantId]
    );

    return reply.send({
      success: true,
      data: {
        connected: rows.length > 0,
        workspace: rows[0] ? {
          id:   rows[0].team_id,
          name: rows[0].team_name,
          connectedAt: rows[0].created_at,
        } : null,
      },
    });
  });

  // GET /users — list mapped users
  server.get("/users", { preHandler: [requireRep] }, async (request, reply) => {
    const { tenantId } = request.user;

    const { rows } = await pool.query(
      `SELECT sum.*, u.first_name, u.last_name, u.email
       FROM slack_user_mappings sum
       JOIN users u ON u.id = sum.user_id
       WHERE sum.tenant_id = $1
       ORDER BY u.first_name`,
      [tenantId]
    );

    return reply.send({
      success: true,
      data: rows.map((r: Record<string, unknown>) => ({
        id:           r.id,
        userId:       r.user_id,
        userName:     `${r.first_name} ${r.last_name}`,
        userEmail:    r.email,
        slackUserId:  r.slack_user_id,
        slackEmail: r.slack_email,
        mappedAt:     r.mapped_at,
      })),
    });
  });

  // POST /users/sync — auto-map by email
  server.post("/users/sync", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { tenantId } = request.user;

    const slackUsers = await listSlackUsers(tenantId);
    if (slackUsers.length === 0) {
      return reply.send({ success: true, data: { mapped: 0 } });
    }

    // Get CRM users
    const { rows: crmUsers } = await pool.query(
      `SELECT id, email FROM users WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId]
    );

    const emailToSlack = new Map(slackUsers.map((u) => [u.email.toLowerCase(), u]));
    let mapped = 0;

    for (const crm of crmUsers) {
      const slack = emailToSlack.get((crm.email as string).toLowerCase());
      if (!slack) continue;

      await pool.query(
        `INSERT INTO slack_user_mappings (tenant_id, user_id, slack_user_id, slack_email)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET slack_user_id = $3, slack_email = $4, mapped_at = NOW()`,
        [tenantId, crm.id, slack.id, slack.email]
      );
      mapped++;
    }

    return reply.send({ success: true, data: { mapped, total: crmUsers.length } });
  });

  // DELETE /disconnect — remove Slack connection
  server.delete("/disconnect", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { tenantId } = request.user;
    await pool.query(`DELETE FROM slack_workspaces WHERE tenant_id = $1`, [tenantId]);
    await pool.query(`DELETE FROM slack_user_mappings WHERE tenant_id = $1`, [tenantId]);
    return reply.status(204).send();
  });
}
