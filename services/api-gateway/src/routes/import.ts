/**
 * Data import routes — CSV/Excel/JSON file upload, column mapping, processing.
 *
 * POST /api/v1/import/upload             — upload file, create import job
 * POST /api/v1/import/:jobId/mapping     — save column mapping, start processing
 * GET  /api/v1/import/:jobId             — check status + progress
 * GET  /api/v1/import/:jobId/preview     — preview first 5 rows
 * POST /api/v1/import/:jobId/cancel      — cancel in-progress job
 * GET  /api/v1/import                    — list import jobs
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireRep } from "../middleware/rbac";
import { requireCrmRead, requireCrmWrite } from "../middleware/scope";
import { importProcessorQueue } from "../workers/import-processor";

const MappingSchema = z.object({
  column_mapping: z.record(z.string()), // { csvColumn: crmField }
  dedup_field:    z.string().optional(),
});

export async function importRoutes(server: FastifyInstance) {
  // POST /upload — multipart file upload
  server.post("/upload", { preHandler: [requireRep, requireCrmWrite] }, async (request, reply) => {
    const { tenantId, sub: userId } = request.user;
    const body = request.body as {
      entity_type?: string;
      file_name?: string;
      file_format?: string;
      file_data?: string; // base64-encoded file contents
      total_rows?: number;
      columns?: string[];
      preview_rows?: unknown[];
    };

    if (!body.entity_type || !body.file_name || !body.file_format) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "entity_type, file_name, and file_format are required" },
      });
    }

    const validFormats = ["csv", "xlsx", "json"];
    if (!validFormats.includes(body.file_format)) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: `file_format must be one of: ${validFormats.join(", ")}` },
      });
    }

    // Store file data as a storage_key (in production, upload to S3)
    const storageKey = `imports/${tenantId}/${Date.now()}_${body.file_name}`;

    const { rows } = await pool.query(
      `INSERT INTO import_jobs
         (tenant_id, user_id, entity_type, file_name, file_format, status,
          total_rows, storage_key)
       VALUES ($1, $2, $3, $4, $5, 'mapping', $6, $7)
       RETURNING *`,
      [tenantId, userId, body.entity_type, body.file_name, body.file_format,
       body.total_rows ?? null, storageKey]
    );

    return reply.status(201).send({
      success: true,
      data: {
        ...toImportJob(rows[0]),
        columns: body.columns ?? [],
        previewRows: body.preview_rows ?? [],
      },
    });
  });

  // POST /:jobId/mapping — save column mapping, start processing
  server.post("/:jobId/mapping", { preHandler: [requireRep, requireCrmWrite] }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const { tenantId } = request.user;

    const parsed = MappingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { rows } = await pool.query(
      `UPDATE import_jobs
       SET column_mapping = $1, status = 'processing', updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3 AND status = 'mapping'
       RETURNING *`,
      [JSON.stringify(parsed.data.column_mapping), jobId, tenantId]
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    // Enqueue processing job
    await importProcessorQueue.add("process-import", {
      jobId,
      tenantId,
      dedupField: parsed.data.dedup_field,
    });

    return reply.send({ success: true, data: toImportJob(rows[0]) });
  });

  // GET /:jobId — check status
  server.get("/:jobId", { preHandler: [requireRep, requireCrmRead] }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const { tenantId } = request.user;

    const { rows } = await pool.query(
      `SELECT * FROM import_jobs WHERE id = $1 AND tenant_id = $2`,
      [jobId, tenantId]
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    return reply.send({ success: true, data: toImportJob(rows[0]) });
  });

  // GET /:jobId/preview — preview first 5 rows
  server.get("/:jobId/preview", { preHandler: [requireRep, requireCrmRead] }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const { tenantId } = request.user;

    const { rows } = await pool.query(
      `SELECT column_mapping, storage_key, entity_type FROM import_jobs
       WHERE id = $1 AND tenant_id = $2`,
      [jobId, tenantId]
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    // In a full implementation, read from S3 and apply mapping
    return reply.send({
      success: true,
      data: { mapping: rows[0].column_mapping, preview: [] },
    });
  });

  // POST /:jobId/cancel — cancel in-progress job
  server.post("/:jobId/cancel", { preHandler: [requireRep, requireCrmWrite] }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const { tenantId } = request.user;

    const { rows } = await pool.query(
      `UPDATE import_jobs SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status IN ('pending', 'mapping', 'processing')
       RETURNING *`,
      [jobId, tenantId]
    );

    if (!rows.length) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
    }

    return reply.send({ success: true, data: toImportJob(rows[0]) });
  });

  // GET / — list import jobs
  server.get("/", { preHandler: [requireRep, requireCrmRead] }, async (request, reply) => {
    const { tenantId } = request.user;
    const { page, limit } = request.query as { page?: string; limit?: string };

    const pg = Math.max(1, parseInt(page ?? "1", 10));
    const lim = Math.min(100, Math.max(1, parseInt(limit ?? "20", 10)));

    const { rows } = await pool.query(
      `SELECT * FROM import_jobs WHERE tenant_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [tenantId, lim, (pg - 1) * lim]
    );

    return reply.send({ success: true, data: rows.map(toImportJob) });
  });
}

function toImportJob(row: Record<string, unknown>) {
  return {
    id:           row.id,
    entityType:   row.entity_type,
    fileName:     row.file_name,
    fileFormat:   row.file_format,
    status:       row.status,
    columnMapping: row.column_mapping,
    totalRows:    row.total_rows,
    processedRows: row.processed_rows,
    createdRows:  row.created_rows,
    updatedRows:  row.updated_rows,
    skippedRows:  row.skipped_rows,
    errorRows:    row.error_rows,
    errors:       row.errors,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  };
}
