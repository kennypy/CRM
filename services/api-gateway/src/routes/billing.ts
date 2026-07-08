/**
 * Billing routes
 *
 * POST /api/v1/billing/portal — create a Stripe Customer Portal session
 * GET  /api/v1/billing/status — current subscription status for the tenant
 */

import type { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { z } from "zod";
import { randomBytes, createHash } from "crypto";
import { pool } from "../db";
import { denyApiKeys } from "../middleware/scope";
import { requireAdmin } from "../middleware/rbac";

/** Current seat picture for a tenant: usage, effective limit, and unit price. */
async function seatSnapshot(tenantId: string) {
  const { rows } = await pool.query(
    `SELECT t.plan,
            COALESCE(t.seat_limit, pe.seat_limit, 5) AS seat_limit,
            COALESCE(pe.price_per_seat_cents, 1500)  AS unit_price_cents,
            COALESCE(pe.currency, 'USD')             AS currency,
            (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id AND u.deleted_at IS NULL) AS seats_used
       FROM tenants t
       LEFT JOIN plan_entitlements pe ON pe.plan = t.plan
      WHERE t.id = $1`,
    [tenantId],
  );
  return rows[0] as {
    plan: string; seat_limit: number; unit_price_cents: number; currency: string; seats_used: number;
  } | undefined;
}

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

  // GET /api/v1/billing/seat-pricing — cost per seat + current usage, so the
  // "add seats" dialog can show the monthly cost before the admin commits.
  server.get("/seat-pricing", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const snap = await seatSnapshot(request.user.tenantId);
    if (!snap) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({
      success: true,
      data: {
        plan:            snap.plan,
        seatsUsed:       snap.seats_used,
        seatLimit:       snap.seat_limit,
        unitPriceCents:  snap.unit_price_cents,
        currency:        snap.currency,
      },
    });
  });

  // POST /api/v1/billing/seats — an admin asks for more seats. Three routes:
  //   self_approve → accept the cost now; seats added immediately.
  //   finance      → route to a finance director via a tokened approval link.
  //   owner        → request the seats from the platform owner (provider console).
  server.post("/seats", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const schema = z.object({
      seats:        z.number().int().positive().max(1000),
      decision:     z.enum(["self_approve", "finance", "owner"]),
      financeEmail: z.string().email().optional(),
      note:         z.string().max(2000).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });
    }
    const { seats, decision, financeEmail, note } = parsed.data;
    if (decision === "finance" && !financeEmail) {
      return reply.status(400).send({ success: false, error: { code: "FINANCE_EMAIL_REQUIRED", message: "Enter the finance director's email to route the request." } });
    }

    const { tenantId, sub: userId } = request.user;
    const snap = await seatSnapshot(tenantId);
    if (!snap) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });

    const { rows: [u] } = await pool.query(
      `SELECT first_name, last_name FROM users WHERE id = $1`, [userId],
    );
    const requestedByName = u ? `${u.first_name} ${u.last_name}`.trim() : null;

    // Finance channel gets a single-use approval token (hash stored, raw returned).
    let approvalPath: string | null = null;
    let tokenHash: string | null = null;
    if (decision === "finance") {
      const raw = randomBytes(32).toString("hex");
      tokenHash = createHash("sha256").update(raw).digest("hex");
      approvalPath = `/seat-approval?token=${raw}`;
    }

    const status = decision === "self_approve" ? "approved" : "pending";

    const { rows: [reqRow] } = await pool.query(
      `INSERT INTO seat_requests
         (tenant_id, requested_by, requested_by_name, seats, unit_price_cents, currency,
          decision, status, finance_email, note, token_hash, resolved_by, resolved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, seats, status, decision, created_at`,
      [tenantId, userId, requestedByName, seats, snap.unit_price_cents, snap.currency,
       decision, status, financeEmail ?? null, note ?? null, tokenHash,
       decision === "self_approve" ? userId : null,
       decision === "self_approve" ? new Date() : null],
    );

    // Self-approval applies immediately: bump the seat override by the amount.
    if (decision === "self_approve") {
      await pool.query(
        `UPDATE tenants SET seat_limit = $2 WHERE id = $1`,
        [tenantId, snap.seat_limit + seats],
      );
    }

    return reply.status(201).send({
      success: true,
      data: {
        id: reqRow.id,
        status: reqRow.status,
        decision: reqRow.decision,
        seats: reqRow.seats,
        newSeatLimit: decision === "self_approve" ? snap.seat_limit + seats : snap.seat_limit,
        // For finance: the shareable link (email delivery falls back to this).
        approvalPath,
      },
    });
  });

  // GET /api/v1/billing/seat-requests — this workspace's recent seat requests.
  server.get("/seat-requests", { preHandler: [denyApiKeys, requireAdmin] }, async (request, reply) => {
    const { rows } = await pool.query(
      `SELECT id, seats, unit_price_cents, currency, decision, status,
              finance_email, note, requested_by_name, resolved_by, resolved_at, created_at
         FROM seat_requests
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [request.user.tenantId],
    );
    return reply.send({ success: true, data: rows });
  });
}
