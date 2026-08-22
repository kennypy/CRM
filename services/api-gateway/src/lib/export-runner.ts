/**
 * Tenant data export runner — shared by the synchronous route path
 * (routes/export.ts) and the background export worker
 * (workers/export-processor.ts). Takes the pg pool as a parameter because the
 * two contexts use different pools (request-scoped app pool vs service pool).
 */

import type { Pool } from "pg";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { internalFetch } from "./internal-fetch";
import { GRAPH_CORE_URL } from "./service-urls";

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

type Row = Record<string, unknown>;

/** Pull the graph-resident entities (contacts, companies, deals) from graph-core. */
async function fetchGraphEntities(tenantId: string): Promise<{ contacts: Row[]; companies: Row[]; deals: Row[] }> {
  const empty: { contacts: Row[]; companies: Row[]; deals: Row[] } = { contacts: [], companies: [], deals: [] };
  try {
    const resp = await internalFetch(`${GRAPH_CORE_URL}/graph/export?tenantId=${encodeURIComponent(tenantId)}`);
    if (!resp.ok) return empty;
    const json = await resp.json() as { success?: boolean; data?: { contacts?: Row[]; companies?: Row[]; deals?: Row[] } };
    if (!json.success || !json.data) return empty;
    return {
      contacts:  json.data.contacts  ?? [],
      companies: json.data.companies ?? [],
      deals:     json.data.deals     ?? [],
    };
  } catch {
    return empty;
  }
}

export async function runExport(
  db: Pool,
  tenantId: string,
  format: "json" | "csv"
): Promise<string> {
  // Contacts, companies and deals live in the Apache AGE graph (owned by
  // graph-core); activities and tasks are relational. Fetch both in parallel.
  const [graph, activities, tasks] = await Promise.all([
    fetchGraphEntities(tenantId),
    db.query(`SELECT * FROM activities WHERE tenant_id = $1`, [tenantId]).catch(() => ({ rows: [] })),
    db.query(`SELECT * FROM tasks WHERE tenant_id = $1`, [tenantId]).catch(() => ({ rows: [] })),
  ]);

  const exportData = {
    exported_at: new Date().toISOString(),
    tenant_id:   tenantId,
    contacts:    graph.contacts,
    companies:   graph.companies,
    deals:       graph.deals,
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

  // Prefer object storage (signed URL, deletes after 24h). But self-hosted
  // deploys may not have a reachable/configured S3/minio — in that case fall
  // back to returning the payload inline as a data: URL so the export always
  // works instead of hard-failing.
  try {
    await s3.send(new PutObjectCommand({
      Bucket:      S3_BUCKET,
      Key:         key,
      Body:        body,
      ContentType: contentType,
      // Auto-delete after 24 hours (requires lifecycle policy on the bucket)
      Metadata:    { tenant_id: tenantId, exported_at: exportData.exported_at },
    }));

    // Generate a pre-signed download URL valid for 1 hour.
    return await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
      { expiresIn: 3600 },
    );
  } catch {
    // Object storage unavailable — return the content inline. The browser can
    // download a data: URL directly; API callers get the payload in the URL.
    const b64 = Buffer.from(body, "utf-8").toString("base64");
    return `data:${contentType};base64,${b64}`;
  }
}
