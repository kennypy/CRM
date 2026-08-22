/**
 * Data export — GDPR portability + anti-lock-in guarantee.
 *
 * POST /api/v1/export          — run (small tenants) or queue a full export
 * GET  /api/v1/export/:jobId   — check a queued export's status + URL
 *
 * Small tenants export synchronously; large ones (>200k relational rows) get
 * an export_jobs row and a background job on the "export" queue (consumed by
 * workers/export-processor.ts). Files are stored in S3/R2 behind a signed URL.
 *
 * Supported formats: json (default), csv
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Queue } from "bullmq";
import { pool } from "../db";
import { requireCrmRead } from "../middleware/scope";
import { requireCapability } from "../middleware/capabilities";
import { runExport } from "../lib/export-runner";
import { redisConnection } from "@nexcrm/service-common/redis";

const exportQueue = new Queue("export", { connection: redisConnection() });

export async function exportRoutes(server: FastifyInstance) {
  server.post("/", { preHandler: [requireCrmRead, requireCapability("can_export")] }, async (request, reply) => {
    const { tenantId, sub: userId } = request.user;
    const parsed = z.object({
      format: z.enum(["json", "csv"]).default("json"),
    }).safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });
    }

    // Quick record count (relational entities only) to decide sync vs async.
    // Graph entities aren't counted here — contacts/companies/deals come from
    // graph-core inside runExport — but activities/tasks are the bulk of volume.
    const { rows: [{ count }] } = await pool.query<{ count: string }>(
      `SELECT (
         (SELECT COUNT(*) FROM activities WHERE tenant_id = $1) +
         (SELECT COUNT(*) FROM tasks      WHERE tenant_id = $1)
       ) AS count`,
      [tenantId],
    ).catch(() => ({ rows: [{ count: "0" }] }));

    if (parseInt(count, 10) > 200_000) {
      const { rows: [jobRow] } = await pool.query<{ id: string }>(
        `INSERT INTO export_jobs (tenant_id, requested_by, format)
         VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, userId, parsed.data.format]
      );
      await exportQueue.add("tenant-export", {
        jobRowId: jobRow.id,
        tenantId,
        format: parsed.data.format,
      });
      server.log.info({ tenantId, jobId: jobRow.id }, "export.queued");
      return reply.status(202).send({
        success: true,
        data: {
          jobId: jobRow.id,
          message: "Export queued. Poll GET /api/v1/export/" + jobRow.id + " for the download URL.",
        },
      });
    }

    try {
      const downloadUrl = await runExport(pool, tenantId, parsed.data.format);
      server.log.info({ tenantId, format: parsed.data.format }, "export.completed");
      return reply.send({ success: true, data: { url: downloadUrl, expires_in_seconds: 3600 } });
    } catch (err: any) {
      server.log.error({ err: err.message, tenantId }, "export.failed");
      return reply.status(500).send({
        success: false,
        error: { code: "EXPORT_FAILED", message: "Export generation failed. Please try again." },
      });
    }
  });

  // GET /api/v1/export/:jobId — status of a queued export
  server.get("/:jobId", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const { tenantId } = request.user;
    const parsed = z.object({ jobId: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });
    }

    const { rows } = await pool.query(
      `SELECT id, format, status, download_url, error, created_at, completed_at
       FROM export_jobs
       WHERE id = $1 AND tenant_id = $2`,
      [parsed.data.jobId, tenantId]
    );
    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    const job = rows[0];
    return reply.send({
      success: true,
      data: {
        jobId:     job.id,
        format:    job.format,
        status:    job.status,
        url:       job.download_url,
        error:     job.error,
        createdAt: job.created_at,
        completedAt: job.completed_at,
        expires_in_seconds: job.download_url ? 3600 : null,
      },
    });
  });
}
