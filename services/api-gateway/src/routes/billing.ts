/**
 * Billing routes
 *
 * POST /api/v1/billing/portal — create a Stripe Customer Portal session
 * GET  /api/v1/billing/status — current subscription status for the tenant
 */

import type { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { pool } from "../db";
import { denyApiKeys } from "../middleware/scope";
import { requireAdmin } from "../middleware/rbac";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" as any })
  : null;

export async function billingRoutes(server: FastifyInstance) {
  // POST /api/v1/billing/portal
  // Returns a short-lived URL to Stripe's hosted billing management portal.
  // The customer can update their payment method, view invoices, or cancel.
  server.post("/portal", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    if (!stripe) {
      return reply.status(503).send({
        success: false,
        error: { code: "BILLING_NOT_CONFIGURED", message: "Billing is not configured" },
      });
    }

    const { tenantId } = request.user;
    const returnUrl    = (request.body as Record<string, unknown>)?.returnUrl as string
      ?? `${process.env.APP_URL ?? "http://localhost:3000"}/settings/billing`;

    const { rows: [tenant] } = await pool.query<{
      stripe_customer_id:          string | null;
      stripe_subscription_status:  string | null;
    }>(
      `SELECT stripe_customer_id, stripe_subscription_status FROM tenants WHERE id = $1`,
      [tenantId],
    );

    if (!tenant?.stripe_customer_id) {
      return reply.status(400).send({
        success: false,
        error: { code: "NO_BILLING_ACCOUNT", message: "No billing account found for this workspace" },
      });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer:   tenant.stripe_customer_id,
      return_url: returnUrl,
    });

    return reply.send({ success: true, data: { url: session.url } });
  });

  // GET /api/v1/billing/status
  server.get("/status", { preHandler: [denyApiKeys] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { rows: [tenant] } = await pool.query(
      `SELECT t.plan, t.stripe_subscription_status, t.subscription_period_end,
              t.stripe_customer_id IS NOT NULL AS has_billing_account,
              COALESCE(t.seat_limit, pe.seat_limit, 5) AS seat_limit,
              (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id AND u.deleted_at IS NULL) AS seats_used
         FROM tenants t
         LEFT JOIN plan_entitlements pe ON pe.plan = t.plan
        WHERE t.id = $1`,
      [tenantId],
    );
    if (!tenant) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: tenant });
  });
}
