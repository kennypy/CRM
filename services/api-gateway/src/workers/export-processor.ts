/**
 * Export processor — consumes the "export" BullMQ queue.
 *
 * Large tenants (>200k relational rows) get a 202 + export_jobs row from
 * POST /api/v1/export instead of a synchronous export; this worker generates
 * the file and records the download URL on the job row, which the caller
 * polls via GET /api/v1/export/:jobId. (Previously the queue had no consumer,
 * so queued exports accumulated in Redis forever.)
 */

import { Worker } from "bullmq";
import { redisConnection } from "@nexcrm/service-common/redis";

import { servicePool } from "../db";
import { runExport } from "../lib/export-runner";
import { attachWorkerErrorHandler } from "./worker-utils";

const QUEUE_NAME = "export";

interface ExportJob {
  jobRowId: string;
  tenantId: string;
  format: "json" | "csv";
}

export function startExportProcessorWorker(): void {
  const worker = new Worker<ExportJob>(
    QUEUE_NAME,
    async (job) => {
      const { jobRowId, tenantId, format } = job.data;

      await servicePool.query(
        `UPDATE export_jobs SET status = 'processing' WHERE id = $1 AND tenant_id = $2`,
        [jobRowId, tenantId]
      );

      try {
        const url = await runExport(servicePool, tenantId, format);
        await servicePool.query(
          `UPDATE export_jobs
           SET status = 'completed', download_url = $1, completed_at = NOW()
           WHERE id = $2 AND tenant_id = $3`,
          [url, jobRowId, tenantId]
        );
        console.log(`[export-processor] completed export ${jobRowId} for tenant ${tenantId}`);
      } catch (err: any) {
        await servicePool.query(
          `UPDATE export_jobs
           SET status = 'failed', error = $1, completed_at = NOW()
           WHERE id = $2 AND tenant_id = $3`,
          [String(err?.message ?? err).slice(0, 500), jobRowId, tenantId]
        ).catch(() => {});
        throw err;
      }
    },
    { connection: redisConnection(), concurrency: 2 }
  );

  attachWorkerErrorHandler(worker, "export-processor");
}
