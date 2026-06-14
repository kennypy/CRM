/**
 * Sequence routes — full CRUD for sequences, steps, enrollments, analytics.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, auditLog, emitEvent } from "../db";
import { assertNotOptedOut, OptOutError } from "../lib/compliance";
import {
  assertSequenceQuota,
  assertEnrollmentQuota,
} from "../lib/plan-limits";
import { computeScheduledAt } from "../lib/scheduler";
import { tenantOf, userOf } from "../lib/auth-context";

// ── Schemas ───────────────────────────────────────────────────────────────────

const CreateSequenceSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  goal:        z.string().max(500).optional(),
  settings:    z.object({
    timezoneMode: z.enum(["contact", "rep", "fixed"]).default("contact"),
    fixedTz:      z.string().max(64).default("UTC"),
    sendDays:     z.array(z.number().int().min(1).max(7)).default([1,2,3,4,5]),
    sendStart:    z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
    sendEnd:      z.string().regex(/^\d{2}:\d{2}$/).default("17:00"),
  }).default({}),
});

const StepSchema = z.object({
  stepNumber:      z.number().int().min(1),
  type:            z.enum(["email", "call", "linkedin_task"]),
  dayOffset:       z.number().int().min(0).default(0),
  timeOfDay:       z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  subjectTemplate: z.string().max(998).optional(),
  bodyTemplate:    z.string().max(100_000).optional(),
  taskNote:        z.string().max(2000).optional(),
  aiSuggestions:   z.boolean().default(true),
  settings:        z.record(z.unknown()).default({}),
});

const EnrollSchema = z.object({
  contacts: z.array(z.object({
    id:        z.string().uuid().optional(),
    email:     z.string().email(),
    firstName: z.string().max(100).default(""),
    lastName:  z.string().max(100).default(""),
    timezone:  z.string().max(64).default("UTC"),
    title:     z.string().optional(),
    company:   z.string().optional(),
  })).min(1).max(500),
});

// ── Routes ────────────────────────────────────────────────────────────────────

export async function sequencesRoutes(fastify: FastifyInstance) {
  // GET /sequences
  fastify.get("/", async (request, reply) => {
    const tenantId = tenantOf(request);
    const { status } = request.query as { status?: string };
    const params: unknown[] = [tenantId];
    let where = "tenant_id = $1 AND deleted_at IS NULL";
    if (status) { params.push(status); where += ` AND status = $${params.length}`; }

    const { rows } = await pool.query(
      `SELECT id, name, description, status, goal,
              active_enrollments, completed_enrollments, settings,
              owner_id, created_at, updated_at
       FROM sequences WHERE ${where}
       ORDER BY created_at DESC`,
      params,
    );
    return reply.send({ success: true, data: rows });
  });

  // POST /sequences
  fastify.post("/", async (request, reply) => {
    const tenantId = tenantOf(request);
    const userId   = userOf(request);

    const parsed = CreateSequenceSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });

    try { await assertSequenceQuota(tenantId); }
    catch (err: any) { return reply.status(429).send({ success: false, error: { code: "PLAN_LIMIT", message: err.message } }); }

    const { name, description, goal, settings } = parsed.data;
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO sequences (tenant_id, name, description, goal, owner_id, settings)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       RETURNING id`,
      [tenantId, name, description ?? null, goal ?? null, userId, JSON.stringify(settings)],
    );
    const id = rows[0].id;
    await auditLog({ tenantId, userId, action: "sequence.created", entityType: "sequence", entityId: id, after: { name } });
    const created = await getSequenceById(id, tenantId);
    return reply.status(201).send({ success: true, data: created });
  });

  // GET /sequences/:id
  fastify.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = tenantOf(request);
    const seq = await getSequenceById(id, tenantId);
    if (!seq) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    return reply.send({ success: true, data: seq });
  });

  // PATCH /sequences/:id
  fastify.patch("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = tenantOf(request);
    const userId   = userOf(request);

    const parsed = CreateSequenceSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });

    const fields = parsed.data;
    const params: unknown[] = [tenantId, id];
    const sets: string[] = ["updated_at=NOW()"];

    if (fields.name        !== undefined) { params.push(fields.name);                       sets.push(`name=$${params.length}`); }
    if (fields.description !== undefined) { params.push(fields.description);                sets.push(`description=$${params.length}`); }
    if (fields.goal        !== undefined) { params.push(fields.goal);                       sets.push(`goal=$${params.length}`); }
    if (fields.settings    !== undefined) { params.push(JSON.stringify(fields.settings));   sets.push(`settings=$${params.length}::jsonb`); }

    const { rowCount } = await pool.query(
      `UPDATE sequences SET ${sets.join(",")} WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`,
      params,
    );
    if (!rowCount) return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });

    await auditLog({ tenantId, userId, action: "sequence.updated", entityType: "sequence", entityId: id, after: fields });
    return reply.send({ success: true, data: await getSequenceById(id, tenantId) });
  });

  // PATCH /sequences/:id/status — activate / pause / archive
  fastify.patch("/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = tenantOf(request);
    const userId   = userOf(request);
    const body = z.object({ status: z.enum(["active","paused","archived"]) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });

    if (body.data.status === "active") {
      try { await assertSequenceQuota(tenantId); }
      catch (err: any) { return reply.status(429).send({ success: false, error: { code: "PLAN_LIMIT", message: err.message } }); }
    }

    await pool.query(
      `UPDATE sequences SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND deleted_at IS NULL`,
      [body.data.status, id, tenantId],
    );
    await auditLog({ tenantId, userId, action: `sequence.${body.data.status}`, entityType: "sequence", entityId: id });
    return reply.send({ success: true, data: { status: body.data.status } });
  });

  // DELETE /sequences/:id — soft delete
  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = tenantOf(request);
    const userId   = userOf(request);
    await pool.query(
      `UPDATE sequences SET deleted_at=NOW(), status='archived', updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId],
    );
    await auditLog({ tenantId, userId, action: "sequence.deleted", entityType: "sequence", entityId: id });
    return reply.status(204).send();
  });

  // ── Steps ──────────────────────────────────────────────────────────────────

  // GET /sequences/:id/steps
  fastify.get("/:id/steps", async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = tenantOf(request);
    const { rows } = await pool.query(
      `SELECT * FROM sequence_steps WHERE sequence_id=$1 AND tenant_id=$2 ORDER BY step_number`,
      [id, tenantId],
    );
    return reply.send({ success: true, data: rows });
  });

  // POST /sequences/:id/steps
  fastify.post("/:id/steps", async (request, reply) => {
    const { id: sequenceId } = request.params as { id: string };
    const tenantId = tenantOf(request);

    const parsed = StepSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });

    const s = parsed.data;
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO sequence_steps
         (tenant_id, sequence_id, step_number, type, day_offset, time_of_day,
          subject_template, body_template, task_note, ai_suggestions, settings)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
       ON CONFLICT (sequence_id, step_number)
       DO UPDATE SET
         type=$4, day_offset=$5, time_of_day=$6,
         subject_template=$7, body_template=$8, task_note=$9,
         ai_suggestions=$10, settings=$11::jsonb, updated_at=NOW()
       RETURNING id`,
      [
        tenantId, sequenceId, s.stepNumber, s.type, s.dayOffset, s.timeOfDay,
        s.subjectTemplate ?? null, s.bodyTemplate ?? null, s.taskNote ?? null,
        s.aiSuggestions, JSON.stringify(s.settings),
      ],
    );
    return reply.status(201).send({ success: true, data: { id: rows[0].id } });
  });

  // DELETE /sequences/:id/steps/:stepId
  fastify.delete("/:id/steps/:stepId", async (request, reply) => {
    const { id: sequenceId, stepId } = request.params as { id: string; stepId: string };
    const tenantId = tenantOf(request);

    // Skip any pending/scheduled executions for this step before deleting it
    await pool.query(
      `UPDATE sequence_step_executions
          SET status = 'skipped', executed_at = NOW(), updated_at = NOW()
        WHERE step_id = $1 AND tenant_id = $2 AND status IN ('pending', 'scheduled')`,
      [stepId, tenantId],
    );

    await pool.query(
      `DELETE FROM sequence_steps WHERE id=$1 AND sequence_id=$2 AND tenant_id=$3`,
      [stepId, sequenceId, tenantId],
    );
    return reply.status(204).send();
  });

  // ── Enrollments ────────────────────────────────────────────────────────────

  // GET /sequences/:id/enrollments
  fastify.get("/:id/enrollments", async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = tenantOf(request);
    const { status } = request.query as { status?: string };
    const params: unknown[] = [id, tenantId];
    let where = "sequence_id=$1 AND tenant_id=$2";
    if (status) { params.push(status); where += ` AND status=$${params.length}`; }

    const { rows } = await pool.query(
      `SELECT id, contact_id, contact_email, contact_first_name, contact_last_name,
              status, current_step, enrolled_at, finished_at
       FROM sequence_enrollments
       WHERE ${where}
       ORDER BY enrolled_at DESC
       LIMIT 200`,
      params,
    );
    return reply.send({ success: true, data: rows });
  });

  // POST /sequences/:id/enroll — bulk enroll contacts
  fastify.post("/:id/enroll", async (request, reply) => {
    const { id: sequenceId } = request.params as { id: string };
    const tenantId = tenantOf(request);
    const userId   = userOf(request);

    const parsed = EnrollSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } });

    // Get first step to schedule immediately
    const { rows: steps } = await pool.query(
      `SELECT id, step_number, type, day_offset, time_of_day FROM sequence_steps
       WHERE sequence_id=$1 AND tenant_id=$2 ORDER BY step_number LIMIT 1`,
      [sequenceId, tenantId],
    );

    // Get sequence settings
    const { rows: seqRows } = await pool.query(
      `SELECT settings FROM sequences WHERE id=$1 AND tenant_id=$2 LIMIT 1`,
      [sequenceId, tenantId],
    );
    const seqSettings = seqRows[0]?.settings ?? {};

    const results = { enrolled: 0, skipped: 0, reasons: [] as string[] };

    for (const contact of parsed.data.contacts) {
      // Check opt-out
      const optedOut = await pool.query(
        `SELECT 1 FROM opt_out_records WHERE tenant_id=$1 AND contact_email=LOWER($2) AND channel IN ('email','all') LIMIT 1`,
        [tenantId, contact.email],
      );
      if (optedOut.rows.length) {
        results.skipped++;
        results.reasons.push(`${contact.email}: opted out`);
        continue;
      }

      // Check enrollment limit
      try { await assertEnrollmentQuota(tenantId, sequenceId); }
      catch (err: any) {
        results.skipped++;
        results.reasons.push(`${contact.email}: ${err.message}`);
        continue;
      }

      // Upsert enrollment (skip if already active)
      const { rows: enrollRows } = await pool.query<{ id: string }>(
        `INSERT INTO sequence_enrollments
           (tenant_id, sequence_id, contact_id, contact_email,
            contact_first_name, contact_last_name, contact_timezone, enrolled_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (sequence_id, contact_email) DO NOTHING
         RETURNING id`,
        [
          tenantId, sequenceId,
          contact.id ?? null, contact.email.toLowerCase(),
          contact.firstName, contact.lastName,
          contact.timezone, userId,
        ],
      );

      if (!enrollRows.length) {
        results.skipped++;
        results.reasons.push(`${contact.email}: already enrolled`);
        continue;
      }

      const enrollmentId = enrollRows[0].id;

      // Schedule first step execution
      if (steps.length) {
        const step = steps[0];
        const scheduledAt = computeScheduledAt(
          new Date(),
          step.day_offset,
          step.time_of_day,
          contact.timezone,
          seqSettings,
        );

        await pool.query(
          `INSERT INTO sequence_step_executions
             (tenant_id, enrollment_id, step_id, step_number, type, status, scheduled_at)
           VALUES ($1,$2,$3,$4,$5,'scheduled',$6)`,
          [tenantId, enrollmentId, step.id, step.step_number, step.type, scheduledAt.toISOString()],
        );
      }

      // Update sequence active_enrollments counter
      await pool.query(
        `UPDATE sequences SET active_enrollments=active_enrollments+1, updated_at=NOW()
         WHERE id=$1 AND tenant_id=$2`,
        [sequenceId, tenantId],
      );

      await emitEvent(tenantId, "sequence.enrolled", "enrollment", enrollmentId, "outreach", { sequenceId, contactEmail: contact.email });
      results.enrolled++;
    }

    return reply.status(201).send({ success: true, data: results });
  });

  // POST /sequences/:id/enrollments/:enrollId/pause
  fastify.post("/:id/enrollments/:enrollId/pause", async (request, reply) => {
    const { id: sequenceId, enrollId } = request.params as { id: string; enrollId: string };
    const tenantId = tenantOf(request);
    await pool.query(
      `UPDATE sequence_enrollments SET status='paused', pause_reason='manual', updated_at=NOW()
       WHERE id=$1 AND sequence_id=$2 AND tenant_id=$3`,
      [enrollId, sequenceId, tenantId],
    );
    return reply.send({ success: true });
  });

  // POST /sequences/:id/enrollments/:enrollId/resume
  fastify.post("/:id/enrollments/:enrollId/resume", async (request, reply) => {
    const { id: sequenceId, enrollId } = request.params as { id: string; enrollId: string };
    const tenantId = tenantOf(request);
    await pool.query(
      `UPDATE sequence_enrollments SET status='active', pause_reason=NULL, updated_at=NOW()
       WHERE id=$1 AND sequence_id=$2 AND tenant_id=$3`,
      [enrollId, sequenceId, tenantId],
    );
    return reply.send({ success: true });
  });

  // ── Analytics ──────────────────────────────────────────────────────────────

  // GET /sequences/:id/analytics
  fastify.get("/:id/analytics", async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = tenantOf(request);

    const [enrollStats, stepStats] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'active')    AS active,
           COUNT(*) FILTER (WHERE status = 'completed') AS completed,
           COUNT(*) FILTER (WHERE status = 'replied')   AS replied,
           COUNT(*) FILTER (WHERE status = 'opted_out') AS opted_out,
           COUNT(*) FILTER (WHERE status = 'bounced')   AS bounced
         FROM sequence_enrollments
         WHERE sequence_id=$1 AND tenant_id=$2`,
        [id, tenantId],
      ),
      pool.query(
        `SELECT
           e.step_number,
           e.type,
           COUNT(*) FILTER (WHERE e.status IN ('sent','delivered','replied')) AS sent,
           SUM(e.opens)   AS opens,
           SUM(e.clicks)  AS clicks,
           COUNT(*) FILTER (WHERE e.replied_at IS NOT NULL) AS replies,
           COUNT(*) FILTER (WHERE e.bounced_at IS NOT NULL) AS bounces
         FROM sequence_step_executions e
         JOIN sequence_enrollments en ON e.enrollment_id = en.id
         WHERE en.sequence_id=$1 AND e.tenant_id=$2
         GROUP BY e.step_number, e.type
         ORDER BY e.step_number`,
        [id, tenantId],
      ),
    ]);

    const enroll = enrollStats.rows[0] ?? {};
    const totalSent = (stepStats.rows as any[]).reduce((s, r) => s + parseInt(r.sent ?? 0, 10), 0);
    const totalOpens = (stepStats.rows as any[]).reduce((s, r) => s + parseInt(r.opens ?? 0, 10), 0);
    const totalClicks = (stepStats.rows as any[]).reduce((s, r) => s + parseInt(r.clicks ?? 0, 10), 0);
    const totalReplies = (stepStats.rows as any[]).reduce((s, r) => s + parseInt(r.replies ?? 0, 10), 0);

    return reply.send({
      success: true,
      data: {
        enrollments: {
          active:    parseInt(enroll.active   ?? 0, 10),
          completed: parseInt(enroll.completed ?? 0, 10),
          replied:   parseInt(enroll.replied  ?? 0, 10),
          optedOut:  parseInt(enroll.opted_out ?? 0, 10),
          bounced:   parseInt(enroll.bounced  ?? 0, 10),
        },
        rates: {
          openRate:  totalSent > 0 ? +(totalOpens   / totalSent * 100).toFixed(1) : 0,
          clickRate: totalSent > 0 ? +(totalClicks  / totalSent * 100).toFixed(1) : 0,
          replyRate: totalSent > 0 ? +(totalReplies / totalSent * 100).toFixed(1) : 0,
        },
        steps: stepStats.rows,
      },
    });
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function getSequenceById(id: string, tenantId: string) {
  const { rows } = await pool.query(
    `SELECT id, name, description, status, goal,
            active_enrollments, completed_enrollments, settings,
            owner_id, created_at, updated_at
     FROM sequences WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL LIMIT 1`,
    [id, tenantId],
  );
  return rows[0] ?? null;
}
