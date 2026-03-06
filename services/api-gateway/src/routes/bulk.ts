/**
 * Bulk operations routes — update/delete multiple records at once.
 *
 * POST /api/v1/bulk/update  — { entityType, ids[], changes: {} }
 * POST /api/v1/bulk/delete  — { entityType, ids[] }
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db";
import { requireRep, requireManager } from "../middleware/rbac";
import { createProxy } from "../lib/proxy";

const GRAPH_CORE = process.env.GRAPH_CORE_URL ?? "http://localhost:4002";

const BulkUpdateSchema = z.object({
  entity_type: z.enum(["contact", "company", "deal", "activity", "task"]),
  ids:         z.array(z.string().uuid()).min(1).max(500),
  changes:     z.record(z.unknown()),
});

const BulkDeleteSchema = z.object({
  entity_type: z.enum(["contact", "company", "deal", "activity", "task"]),
  ids:         z.array(z.string().uuid()).min(1).max(500),
});

// Entity types that live in graph-core (Apache AGE)
const GRAPH_ENTITIES = new Set(["contact", "company", "deal"]);

// Entity types that live in relational tables
const RELATIONAL_TABLES: Record<string, string> = {
  activity: "activities",
  task: "tasks",
};

export async function bulkRoutes(server: FastifyInstance) {
  // POST /update — bulk update records
  server.post("/update", { preHandler: [requireRep] }, async (request, reply) => {
    const parsed = BulkUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { entity_type, ids, changes } = parsed.data;
    const { tenantId, sub: userId } = request.user;
    let updated = 0;
    const errors: Array<{ id: string; error: string }> = [];

    if (GRAPH_ENTITIES.has(entity_type)) {
      // Proxy to graph-core for graph entities
      for (const id of ids) {
        try {
          const resp = await fetch(
            `${GRAPH_CORE}/${entity_type === "contact" ? "contacts" : entity_type === "company" ? "companies" : "deals"}/${id}?tenantId=${tenantId}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                "x-user-id": userId,
                "x-tenant-id": tenantId,
              },
              body: JSON.stringify(changes),
            }
          );
          if (resp.ok) updated++;
          else errors.push({ id, error: `HTTP ${resp.status}` });
        } catch (err: any) {
          errors.push({ id, error: err.message });
        }
      }
    } else {
      // Relational update
      const table = RELATIONAL_TABLES[entity_type];
      if (!table) {
        return reply.status(400).send({ success: false, error: { code: "INVALID_ENTITY_TYPE" } });
      }

      const setClauses: string[] = [];
      const vals: unknown[] = [tenantId];
      let paramIdx = 2;

      for (const [key, value] of Object.entries(changes)) {
        // Sanitize column name (allow only alphanumeric + underscore)
        if (!/^[a-z_][a-z0-9_]*$/.test(key)) continue;
        setClauses.push(`${key} = $${paramIdx}`);
        vals.push(value);
        paramIdx++;
      }

      if (setClauses.length === 0) {
        return reply.status(400).send({ success: false, error: { code: "NOTHING_TO_UPDATE" } });
      }

      setClauses.push("updated_at = NOW()");

      // Process in batches
      const batchSize = 100;
      for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        const placeholders = batch.map((_, j) => `$${paramIdx + j}`).join(",");
        const batchVals = [...vals, ...batch];

        const { rowCount } = await pool.query(
          `UPDATE ${table} SET ${setClauses.join(", ")}
           WHERE tenant_id = $1 AND id IN (${placeholders})`,
          batchVals
        );
        updated += rowCount ?? 0;
      }
    }

    return reply.send({
      success: true,
      data: { updated, errors: errors.length > 0 ? errors : undefined },
    });
  });

  // POST /delete — bulk delete records
  server.post("/delete", { preHandler: [requireManager] }, async (request, reply) => {
    const parsed = BulkDeleteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
      });
    }

    const { entity_type, ids } = parsed.data;
    const { tenantId, sub: userId } = request.user;
    let deleted = 0;
    const errors: Array<{ id: string; error: string }> = [];

    if (GRAPH_ENTITIES.has(entity_type)) {
      for (const id of ids) {
        try {
          const resp = await fetch(
            `${GRAPH_CORE}/${entity_type === "contact" ? "contacts" : entity_type === "company" ? "companies" : "deals"}/${id}?tenantId=${tenantId}`,
            {
              method: "DELETE",
              headers: {
                "x-user-id": userId,
                "x-tenant-id": tenantId,
              },
            }
          );
          if (resp.ok) deleted++;
          else errors.push({ id, error: `HTTP ${resp.status}` });
        } catch (err: any) {
          errors.push({ id, error: err.message });
        }
      }
    } else {
      const table = RELATIONAL_TABLES[entity_type];
      if (!table) {
        return reply.status(400).send({ success: false, error: { code: "INVALID_ENTITY_TYPE" } });
      }

      // Soft delete via deleted_at if column exists, hard delete otherwise
      const batchSize = 100;
      for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        const placeholders = batch.map((_, j) => `$${j + 2}`).join(",");

        const { rowCount } = await pool.query(
          `DELETE FROM ${table} WHERE tenant_id = $1 AND id IN (${placeholders})`,
          [tenantId, ...batch]
        );
        deleted += rowCount ?? 0;
      }
    }

    return reply.send({
      success: true,
      data: { deleted, errors: errors.length > 0 ? errors : undefined },
    });
  });
}
