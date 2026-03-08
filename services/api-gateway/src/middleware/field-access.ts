/**
 * Field-level access control middleware.
 * Strips hidden fields from responses and blocks writes to read-only fields.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { pool } from "../db";

interface FieldPerm {
  field_name: string;
  access_level: "hidden" | "read_only" | "read_write";
}

/**
 * Get field permissions for a role on an entity type.
 * Returns a map of field_name → access_level.
 * Fields not in the map default to 'read_write'.
 */
export async function getFieldPermissions(
  tenantId: string,
  entityType: string,
  role: string
): Promise<Map<string, string>> {
  const { rows } = await pool.query<FieldPerm>(
    `SELECT field_name, access_level FROM field_permissions
     WHERE tenant_id = $1 AND entity_type = $2 AND role = $3`,
    [tenantId, entityType, role]
  );

  return new Map(rows.map((r) => [r.field_name, r.access_level]));
}

/**
 * Strip hidden fields from a response object (or array of objects).
 */
export function stripHiddenFields(
  data: Record<string, unknown> | Record<string, unknown>[],
  perms: Map<string, string>
): typeof data {
  const hiddenFields = new Set<string>();
  for (const [field, level] of perms) {
    if (level === "hidden") hiddenFields.add(field);
  }

  if (hiddenFields.size === 0) return data;

  const strip = (obj: Record<string, unknown>) => {
    const result = { ...obj };
    for (const field of hiddenFields) {
      delete result[field];
    }
    // Also strip from nested custom_fields
    if (result.custom_fields && typeof result.custom_fields === "object") {
      const cf = { ...(result.custom_fields as Record<string, unknown>) };
      for (const field of hiddenFields) {
        delete cf[field];
      }
      result.custom_fields = cf;
    }
    return result;
  };

  if (Array.isArray(data)) return data.map(strip);
  return strip(data);
}

/**
 * Get the set of read-only fields for a given role + entity type.
 */
export function getReadOnlyFields(perms: Map<string, string>): Set<string> {
  const readOnly = new Set<string>();
  for (const [field, level] of perms) {
    if (level === "read_only" || level === "hidden") readOnly.add(field);
  }
  return readOnly;
}

/**
 * Fastify preHandler that blocks writes to read-only or hidden fields.
 * Checks the request body for any field that the user's role cannot write.
 */
export function blockReadOnlyFields(entityType: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.body || typeof request.body !== "object") return;

    const { tenantId, role } = request.user;
    if (role === "admin" || role === "super_admin") return;

    const perms = await getFieldPermissions(tenantId, entityType, role);
    const readOnly = getReadOnlyFields(perms);

    if (readOnly.size === 0) return;

    const body = request.body as Record<string, unknown>;
    const violations: string[] = [];

    for (const key of Object.keys(body)) {
      if (readOnly.has(key)) violations.push(key);
    }

    // Also check nested custom_fields
    if (body.custom_fields && typeof body.custom_fields === "object") {
      for (const key of Object.keys(body.custom_fields as Record<string, unknown>)) {
        if (readOnly.has(key)) violations.push(key);
      }
    }

    if (violations.length > 0) {
      return reply.status(403).send({
        success: false,
        error: {
          code: "FIELD_ACCESS_DENIED",
          message: `You do not have write access to: ${violations.join(", ")}`,
        },
      });
    }
  };
}
