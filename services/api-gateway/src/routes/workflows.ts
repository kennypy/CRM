/**
 * Workflow definitions CRUD — backed by the workflow_definitions table.
 *
 * Definitions are validated against the automation catalog
 * (lib/automation-catalog.ts) so everything saved here is executable by the
 * workflow engine. Rows saved before validation existed are returned with
 * `needsSetup: true` + `setupReason` and are skipped by the engine.
 *
 * GET    /api/v1/workflows/catalog  — events, triggers, actions (builder contract)
 * GET    /api/v1/workflows          — list tenant workflows
 * POST   /api/v1/workflows          — create a workflow
 * PATCH  /api/v1/workflows/:id      — update name/description/trigger/actions/is_active
 * DELETE /api/v1/workflows/:id      — soft-delete (sets is_active = false, then removes)
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireRep, requireManager } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";
import { moduleAccessGate } from "../middleware/module-access";
import { ACTION_ALIASES, ACTION_CATALOG, EVENT_CATALOG, TRIGGER_CATALOG } from "../lib/automation-catalog";
import { CONDITION_OPERATORS, DefinitionSchema, checkDefinition } from "../lib/workflow-definition";

const CreateSchema = z.object({
  name:        z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  trigger:     z.record(z.unknown()),
  conditions:  z.array(z.record(z.unknown())).optional().default([]),
  actions:     z.array(z.record(z.unknown())).optional().default([]),
  is_active:   z.boolean().optional().default(true),
  category:    z.enum(["deal", "contact", "activity", "ai"]).optional(),
});

const UpdateSchema = z.object({
  name:        z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  trigger:     z.record(z.unknown()).optional(),
  conditions:  z.array(z.record(z.unknown())).optional(),
  actions:     z.array(z.record(z.unknown())).optional(),
  is_active:   z.boolean().optional(),
});

function toWorkflow(row: Record<string, unknown>) {
  const check = checkDefinition(row as { trigger: unknown; conditions: unknown; actions: unknown });
  return {
    needsSetup:  !check.ok,
    setupReason: check.ok ? null : check.reason,
    id:          row.id,
    name:        row.name,
    description: row.description ?? null,
    trigger:     row.trigger,
    conditions:  row.conditions,
    actions:     row.actions,
    is_active:   row.is_active,
    version:     row.version,
    category:    (row.trigger as Record<string, unknown>)?.category ?? null,
    createdBy:   row.created_by ?? null,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
    runCount:    Number(row.run_count ?? 0),
    lastRun:     row.last_run ?? null,
  };
}

export async function workflowsRoutes(server: FastifyInstance) {
  // Custom-role permission grid (Settings → Users → Profiles)
  server.addHook("preHandler", moduleAccessGate("workflows"));
  // ── GET /api/v1/workflows/catalog ─────────────────────────────────────────
  server.get("/catalog", { preHandler: [requireCrmRead] }, async (_request, reply) =>
    reply.send({
      success: true,
      data: {
        events: EVENT_CATALOG,
        triggers: TRIGGER_CATALOG,
        actions: ACTION_CATALOG,
        actionAliases: Object.keys(ACTION_ALIASES),
        conditionOperators: CONDITION_OPERATORS,
      },
    }));

  // ── GET /api/v1/workflows ─────────────────────────────────────────────────
  server.get("/", { preHandler: [requireRep, requireCrmRead] }, async (request, reply) => {
    const tenantId = request.user.tenantId;

    const { rows } = await pool.query(
      `SELECT wd.*,
              COUNT(wr.id) FILTER (WHERE wr.status = 'completed')::int AS run_count,
              MAX(wr.completed_at) AS last_run
       FROM workflow_definitions wd
       LEFT JOIN workflow_runs wr ON wr.workflow_id = wd.id
       WHERE wd.tenant_id = $1
       GROUP BY wd.id
       ORDER BY wd.created_at DESC`,
      [tenantId]
    );

    return reply.send({ success: true, data: rows.map(toWorkflow) });
  });

  // ── POST /api/v1/workflows ────────────────────────────────────────────────
  server.post("/", { preHandler: [requireRep, requireCrmWrite] }, async (request, reply) => {
    const parsed = CreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const def = DefinitionSchema.safeParse({
      trigger: parsed.data.trigger, conditions: parsed.data.conditions, actions: parsed.data.actions,
    });
    if (!def.success) {
      return reply.status(422).send({
        success: false,
        error: { code: "INVALID_WORKFLOW", message: def.error.issues[0].message, details: def.error.issues },
      });
    }
    const { name, description, is_active } = parsed.data;
    const { trigger, conditions, actions } = def.data;
    const { tenantId, sub: userId } = request.user;

    const { rows } = await pool.query(
      `INSERT INTO workflow_definitions
         (tenant_id, name, description, trigger, conditions, actions, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [tenantId, name, description ?? null, JSON.stringify(trigger),
       JSON.stringify(conditions), JSON.stringify(actions), is_active, userId]
    );

    return reply.status(201).send({ success: true, data: toWorkflow(rows[0]) });
  });

  // ── PATCH /api/v1/workflows/:id ───────────────────────────────────────────
  server.patch("/:id", { preHandler: [requireRep, requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { tenantId } = request.user;
    const data = parsed.data;

    // Validate the merged definition whenever any part of it changes, and
    // refuse to activate one the engine cannot run.
    if (data.trigger !== undefined || data.conditions !== undefined || data.actions !== undefined || data.is_active === true) {
      const { rows: [cur] } = await pool.query(
        `SELECT trigger, conditions, actions FROM workflow_definitions WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      if (!cur) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
      const def = DefinitionSchema.safeParse({
        trigger: data.trigger ?? cur.trigger,
        conditions: data.conditions ?? cur.conditions ?? [],
        actions: data.actions ?? cur.actions ?? [],
      });
      if (!def.success) {
        return reply.status(422).send({
          success: false,
          error: { code: "INVALID_WORKFLOW", message: def.error.issues[0].message, details: def.error.issues },
        });
      }
      if (data.trigger !== undefined) data.trigger = def.data.trigger;
      if (data.conditions !== undefined) data.conditions = def.data.conditions;
      if (data.actions !== undefined) data.actions = def.data.actions;
    }

    const sets: string[] = ["updated_at = NOW()", "version = version + 1"];
    const vals: unknown[] = [id, tenantId];

    if (data.name        !== undefined) { vals.push(data.name);                   sets.push(`name = $${vals.length}`); }
    if (data.description !== undefined) { vals.push(data.description);            sets.push(`description = $${vals.length}`); }
    if (data.trigger     !== undefined) { vals.push(JSON.stringify(data.trigger));    sets.push(`trigger = $${vals.length}`); }
    if (data.conditions  !== undefined) { vals.push(JSON.stringify(data.conditions)); sets.push(`conditions = $${vals.length}`); }
    if (data.actions     !== undefined) { vals.push(JSON.stringify(data.actions));    sets.push(`actions = $${vals.length}`); }
    if (data.is_active   !== undefined) { vals.push(data.is_active);              sets.push(`is_active = $${vals.length}`); }

    if (sets.length === 2) {
      return reply.status(400).send({ success: false, error: { code: "NOTHING_TO_UPDATE" } });
    }

    const { rows } = await pool.query(
      `UPDATE workflow_definitions
       SET ${sets.join(", ")}
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      vals
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    return reply.send({ success: true, data: toWorkflow(rows[0]) });
  });

  // ── DELETE /api/v1/workflows/:id ──────────────────────────────────────────
  server.delete("/:id", { preHandler: [requireManager, requireCrmWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;

    const { rowCount } = await pool.query(
      `DELETE FROM workflow_definitions WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );

    if (!rowCount) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    return reply.status(204).send();
  });

  // ── GET /api/v1/workflows/:id/runs ───────────────────────────────────────
  server.get("/:id/runs", { preHandler: [requireRep, requireCrmRead] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId } = request.user;

    const { rows } = await pool.query(
      `SELECT wr.*
       FROM workflow_runs wr
       JOIN workflow_definitions wd ON wd.id = wr.workflow_id
       WHERE wr.workflow_id = $1 AND wd.tenant_id = $2
       ORDER BY wr.started_at DESC
       LIMIT 50`,
      [id, tenantId]
    );

    return reply.send({ success: true, data: rows });
  });
}
