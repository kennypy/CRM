/**
 * Multi-step approval engine (quote discount approvals).
 *
 * Lifecycle:
 *   submit  → approval_requests(pending) + N approval_steps (manager chain)
 *   approve → current step approved; advance, or finalise on the last step
 *   reject  → request rejected; quote stays pending_approval (editable, resubmittable)
 *   recall  → submitter withdraws a pending request
 *
 * While a request is pending the quote is locked against edits (quotes.ts).
 * All state transitions run in a transaction with the request row locked, so
 * two approvers acting at once cannot double-advance a step.
 */
import type { PoolClient } from "pg";
import { pool } from "../db";
import {
  buildApproverChain, computeApprovalLevels, effectiveDiscountPct, type DiscountTier,
} from "./approval-routing";
import { getManagerChain } from "./visibility";

export class ApprovalError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function notify(
  c: PoolClient, tenantId: string, userId: string, title: string, body: string, requestId: string,
  priority: "normal" | "high" = "normal",
) {
  await c.query(
    `INSERT INTO notifications (tenant_id, user_id, type, title, body, priority, action_url, entity_type, entity_id)
     VALUES ($1, $2, 'approval', $3, $4, $5, '/approvals', 'approval_request', $6)`,
    [tenantId, userId, title, body, priority, requestId],
  );
}

export interface QuoteApprovalFacts {
  listSubtotal: number;
  finalPreTax: number;
  total: number;
  discountPct: number;
}

export async function quoteApprovalFacts(c: PoolClient | typeof pool, quoteId: string): Promise<QuoteApprovalFacts> {
  const { rows: [q] } = await c.query(
    `SELECT subtotal, discount_type, discount_value, total FROM quotes WHERE id = $1`, [quoteId],
  );
  const { rows: [agg] } = await c.query(
    `SELECT COALESCE(SUM(quantity * COALESCE(list_price, unit_price)), 0) AS list_subtotal
       FROM quote_items WHERE quote_id = $1`,
    [quoteId],
  );
  const subtotal = Number(q.subtotal);
  const orderDiscount = q.discount_type === "percent"
    ? subtotal * Number(q.discount_value) / 100
    : q.discount_type === "fixed" ? Math.min(Number(q.discount_value), subtotal) : 0;
  const listSubtotal = Number(agg.list_subtotal);
  const finalPreTax = subtotal - orderDiscount;
  return {
    listSubtotal, finalPreTax, total: Number(q.total),
    discountPct: effectiveDiscountPct(listSubtotal, finalPreTax),
  };
}

export async function submitQuoteForApproval(
  tenantId: string, quoteId: string, submitterId: string, comment?: string,
) {
  return withTx(async (c) => {
    const { rows: [q] } = await c.query(
      `SELECT id, quote_number, title, status, approval_required, created_by
         FROM quotes WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [quoteId, tenantId],
    );
    if (!q) throw new ApprovalError(404, "NOT_FOUND", "Quote not found");
    if (!q.approval_required || q.status !== "pending_approval") {
      throw new ApprovalError(409, "APPROVAL_NOT_REQUIRED", "This quote does not currently require approval");
    }
    const { rows: open } = await c.query(
      `SELECT id FROM approval_requests WHERE tenant_id = $1 AND entity_type = 'quote' AND entity_id = $2 AND status = 'pending'`,
      [tenantId, quoteId],
    );
    if (open.length) throw new ApprovalError(409, "ALREADY_SUBMITTED", "An approval request is already pending");

    const facts = await quoteApprovalFacts(c, quoteId);
    const { rows: [t] } = await c.query(`SELECT discount_config FROM tenants WHERE id = $1`, [tenantId]);
    const tiers = ((t?.discount_config ?? {}).tcvTiers ?? []) as DiscountTier[];
    const levels = computeApprovalLevels(facts.discountPct, facts.total, tiers);

    const chain = await getManagerChain(tenantId, submitterId);
    const { rows: fallback } = await c.query(
      `SELECT id FROM users WHERE tenant_id = $1 AND role IN ('admin', 'super_admin') AND deleted_at IS NULL
        ORDER BY created_at`,
      [tenantId],
    );
    const approvers = buildApproverChain(submitterId, chain, fallback.map((r) => r.id as string), levels);
    if (!approvers) {
      throw new ApprovalError(422, "NO_APPROVER",
        "No eligible approver: assign a manager to the submitter or add another admin");
    }

    const label = `${q.quote_number} — ${q.title}`;
    const { rows: [req] } = await c.query(
      `INSERT INTO approval_requests
         (tenant_id, entity_type, entity_id, entity_label, submitted_by, submit_comment, snapshot)
       VALUES ($1, 'quote', $2, $3, $4, $5, $6) RETURNING id`,
      [tenantId, quoteId, label, submitterId, comment ?? null,
       JSON.stringify({ ...facts, levels, tiersApplied: tiers.length })],
    );
    for (let i = 0; i < approvers.length; i++) {
      await c.query(
        `INSERT INTO approval_steps (tenant_id, request_id, step_number, approver_id) VALUES ($1, $2, $3, $4)`,
        [tenantId, req.id, i + 1, approvers[i]],
      );
    }
    await notify(c, tenantId, approvers[0], `Approval needed: ${label}`,
      `Discount ${facts.discountPct}% on ${facts.total.toFixed(2)} (step 1 of ${approvers.length})`, req.id, "high");
    return getRequest(c, tenantId, req.id);
  });
}

export async function actOnRequest(
  tenantId: string, requestId: string, actorId: string, actorRole: string,
  action: "approve" | "reject" | "recall", comment?: string,
) {
  return withTx(async (c) => {
    const { rows: [req] } = await c.query(
      `SELECT * FROM approval_requests WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [requestId, tenantId],
    );
    if (!req) throw new ApprovalError(404, "NOT_FOUND", "Approval request not found");
    if (req.status !== "pending") throw new ApprovalError(409, "NOT_PENDING", `Request is already ${req.status}`);

    if (action === "recall") {
      if (req.submitted_by !== actorId && !["admin", "super_admin"].includes(actorRole)) {
        throw new ApprovalError(403, "FORBIDDEN", "Only the submitter or an admin can recall");
      }
      await c.query(`UPDATE approval_requests SET status = 'recalled', completed_at = NOW() WHERE id = $1`, [requestId]);
      await c.query(
        `UPDATE approval_steps SET status = 'skipped' WHERE request_id = $1 AND status = 'pending'`, [requestId],
      );
      return getRequest(c, tenantId, requestId);
    }

    const { rows: [step] } = await c.query(
      `SELECT * FROM approval_steps WHERE request_id = $1 AND step_number = $2`,
      [requestId, req.current_step],
    );
    if (!step) throw new ApprovalError(500, "BROKEN_REQUEST", "Approval request has no current step");
    const isAdmin = ["admin", "super_admin"].includes(actorRole);
    if (step.approver_id !== actorId && !isAdmin) {
      throw new ApprovalError(403, "NOT_APPROVER", "You are not the approver for the current step");
    }
    // Separation of duties holds even for admins.
    if (req.submitted_by === actorId) {
      throw new ApprovalError(403, "SELF_APPROVAL", "You cannot act on your own approval request");
    }
    if (action === "reject" && !comment?.trim()) {
      throw new ApprovalError(400, "COMMENT_REQUIRED", "A comment is required to reject");
    }

    await c.query(
      `UPDATE approval_steps SET status = $2, comment = $3, acted_at = NOW(),
              approver_id = $4
        WHERE id = $1`,
      [step.id, action === "approve" ? "approved" : "rejected", comment ?? null, actorId],
    );

    if (action === "reject") {
      await c.query(
        `UPDATE approval_requests SET status = 'rejected', completed_at = NOW(), reason = $2 WHERE id = $1`,
        [requestId, comment ?? null],
      );
      await c.query(`UPDATE approval_steps SET status = 'skipped' WHERE request_id = $1 AND status = 'pending'`, [requestId]);
      await notify(c, tenantId, req.submitted_by, `Rejected: ${req.entity_label}`, comment ?? "", requestId, "high");
      return getRequest(c, tenantId, requestId);
    }

    const { rows: [next] } = await c.query(
      `SELECT approver_id, step_number FROM approval_steps WHERE request_id = $1 AND step_number = $2`,
      [requestId, req.current_step + 1],
    );
    if (next) {
      await c.query(`UPDATE approval_requests SET current_step = $2 WHERE id = $1`, [requestId, next.step_number]);
      const total = (await c.query(`SELECT count(*)::int AS n FROM approval_steps WHERE request_id = $1`, [requestId])).rows[0].n;
      await notify(c, tenantId, next.approver_id, `Approval needed: ${req.entity_label}`,
        `Step ${next.step_number} of ${total}`, requestId, "high");
    } else {
      await c.query(`UPDATE approval_requests SET status = 'approved', completed_at = NOW() WHERE id = $1`, [requestId]);
      if (req.entity_type === "quote") {
        await c.query(
          `UPDATE quotes SET status = 'draft', approval_required = false, approved_by = $2,
                  approved_at = NOW(), approved_discount_pct = $4, updated_at = NOW()
            WHERE id = $1 AND tenant_id = $3`,
          [req.entity_id, actorId, tenantId, Number(req.snapshot?.discountPct ?? 0)],
        );
      }
      await notify(c, tenantId, req.submitted_by, `Approved: ${req.entity_label}`, "All approval steps complete", requestId);
    }
    return getRequest(c, tenantId, requestId);
  });
}

export async function getRequest(c: PoolClient | typeof pool, tenantId: string, requestId: string) {
  const { rows: [r] } = await c.query(
    `SELECT ar.*, u.first_name || ' ' || u.last_name AS submitted_by_name
       FROM approval_requests ar LEFT JOIN users u ON u.id = ar.submitted_by
      WHERE ar.id = $1 AND ar.tenant_id = $2`,
    [requestId, tenantId],
  );
  if (!r) return null;
  const { rows: steps } = await c.query(
    `SELECT s.*, u.first_name || ' ' || u.last_name AS approver_name
       FROM approval_steps s LEFT JOIN users u ON u.id = s.approver_id
      WHERE s.request_id = $1 ORDER BY s.step_number`,
    [requestId],
  );
  return toRequest(r, steps);
}

export function toRequest(r: Record<string, any>, steps: Record<string, any>[]) {
  return {
    id: r.id, entityType: r.entity_type, entityId: r.entity_id, entityLabel: r.entity_label,
    status: r.status, reason: r.reason ?? null, submittedBy: r.submitted_by,
    submittedByName: r.submitted_by_name ?? null, submitComment: r.submit_comment ?? null,
    submittedAt: r.submitted_at, completedAt: r.completed_at ?? null, currentStep: r.current_step,
    snapshot: r.snapshot ?? {},
    steps: steps.map((s) => ({
      stepNumber: s.step_number, approverId: s.approver_id, approverName: s.approver_name ?? null,
      status: s.status, comment: s.comment ?? null, actedAt: s.acted_at ?? null,
    })),
  };
}
