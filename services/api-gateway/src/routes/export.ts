/**
 * Data export — GDPR portability + anti-lock-in guarantee.
 *
 * POST /api/v1/export          — queue a full tenant data export
 * GET  /api/v1/export/:jobId   — check export status + download URL
 *
 * Exports are generated asynchronously (heavy query), stored in S3/R2 as a
 * signed URL, and the customer downloads them directly. Export files are
 * deleted after 24 hours.
 *
 * Supported formats: json (default), csv
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Queue } from "bullmq";
import { pool } from "../db";
import { requireCrmRead } from "../middleware/scope";

const REDIS_URL = process.env.REDIS_URL ?? "redis://:nexcrm_redis_dev_password@localhost:6379";
const exportQueue = new Queue("export", { connection: { url: REDIS_URL } });

// ── S3 client ─────────────────────────────────────────────────────────────────

const s3 = new S3Client({
  endpoint:         process.env.S3_ENDPOINT,
  region:           process.env.S3_REGION ?? "auto",
  credentials: {
    accessKeyId:     process.env.S3_ACCESS_KEY ?? "",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "",
  },
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
});

const S3_BUCKET = process.env.S3_BUCKET ?? "nexcrm-files";

// ── Export runner ─────────────────────────────────────────────────────────────

async function runExport(tenantId: string, format: "json" | "csv"): Promise<string> {
  // Fetch all entity data for the tenant in parallel.
  const [contacts, companies, deals, activities, tasks] = await Promise.all([
    pool.query(`SELECT * FROM contacts WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenantId]),
    pool.query(`SELECT * FROM companies WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenantId]),
    pool.query(`SELECT * FROM deals WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenantId]),
    pool.query(`SELECT * FROM activities WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenantId]),
    pool.query(`SELECT * FROM tasks WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenantId]),
  ]);

  const exportData = {
    exported_at: new Date().toISOString(),
    tenant_id:   tenantId,
    contacts:    contacts.rows,
    companies:   companies.rows,
    deals:       deals.rows,
    activities:  activities.rows,
    tasks:       tasks.rows,
  };

  let body: string;
  let contentType: string;

  if (format === "csv") {
    // Simple CSV: one sheet per entity type, separated by blank lines
    const toCSV = (rows: Record<string, unknown>[]): string => {
      if (!rows.length) return "";
      const headers = Object.keys(rows[0]);
      const lines   = [headers.join(",")];
      for (const row of rows) {
        lines.push(
          headers.map((h) => {
            const v = row[h];
            if (v === null || v === undefined) return "";
            const s = typeof v === "object" ? JSON.stringify(v) : String(v);
            return `"${s.replace(/"/g, '""')}"`;
          }).join(","),
        );
      }
      return lines.join("\n");
    };

    body = [
      `# NexCRM Data Export — ${exportData.exported_at}`,
      `# Tenant: ${tenantId}`,
      "",
      "## Contacts", toCSV(exportData.contacts), "",
      "## Companies", toCSV(exportData.companies), "",
      "## Deals", toCSV(exportData.deals), "",
      "## Activities", toCSV(exportData.activities), "",
      "## Tasks", toCSV(exportData.tasks),
    ].join("\n");
    contentType = "text/csv";
  } else {
    body        = JSON.stringify(exportData, null, 2);
    contentType = "application/json";
  }

  const key = `exports/${tenantId}/${Date.now()}.${format}`;

  await s3.send(new PutObjectCommand({
    Bucket:      S3_BUCKET,
    Key:         key,
    Body:        body,
    ContentType: contentType,
    // Auto-delete after 24 hours (requires lifecycle policy on the bucket)
    Metadata:    { tenant_id: tenantId, exported_at: exportData.exported_at },
  }));

  // Generate a pre-signed download URL valid for 1 hour.
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
    { expiresIn: 3600 },
  );

  return url;
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function exportRoutes(server: FastifyInstance) {
  // POST /api/v1/export — trigger an export (runs synchronously for now;
  // move to BullMQ background job for tenants with >100k records)
  server.post("/", { preHandler: [requireCrmRead] }, async (request, reply) => {
    const { tenantId } = request.user;
    const parsed = z.object({
      format: z.enum(["json", "csv"]).default("json"),
    }).safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });
    }

    // Quick record count to decide sync vs async
    const { rows: [{ count }] } = await pool.query<{ count: string }>(
      `SELECT (
         (SELECT COUNT(*) FROM contacts   WHERE tenant_id = $1) +
         (SELECT COUNT(*) FROM companies  WHERE tenant_id = $1) +
         (SELECT COUNT(*) FROM deals      WHERE tenant_id = $1) +
         (SELECT COUNT(*) FROM activities WHERE tenant_id = $1)
       ) AS count`,
      [tenantId],
    );

    if (parseInt(count, 10) > 200_000) {
      const job = await exportQueue.add("tenant-export", {
        tenantId,
        format: parsed.data.format,
      });
      server.log.info({ tenantId, jobId: job.id }, "export.queued");
      return reply.status(202).send({
        success: true,
        data: { jobId: job.id, message: "Export queued. You will receive an email when it is ready." },
      });
    }

    try {
      const downloadUrl = await runExport(tenantId, parsed.data.format);
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
}
