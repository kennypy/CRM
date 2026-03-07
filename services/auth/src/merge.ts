/**
 * Workspace merge logic.
 * Scans two workspaces for conflicts, generates a preview,
 * and executes the merge with user-provided resolutions.
 */

import { pool } from "./db";
import type { MergeConflict, MergeResolution } from "@nexcrm/shared-types";

interface ConflictReport {
  conflicts: MergeConflict[];
  stats: {
    users: { source: number; target: number; conflicts: number };
    contacts: { source: number; target: number; conflicts: number };
    companies: { source: number; target: number; conflicts: number };
    deals: { source: number; target: number };
    sequences: { source: number; target: number; conflicts: number };
    customObjects: { source: number; target: number; conflicts: number };
  };
}

/** Create a new merge record. */
export async function createMerge(sourceId: string, targetId: string, initiatedBy: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO workspace_merges (source_id, target_id, initiated_by, status)
     VALUES ($1, $2, $3, 'previewing')
     RETURNING id`,
    [sourceId, targetId, initiatedBy]
  );
  return rows[0].id;
}

/** Get a merge record by ID. */
export async function getMerge(mergeId: string) {
  const { rows } = await pool.query(
    `SELECT m.*,
            s.name AS source_name, s.slug AS source_slug,
            t.name AS target_name, t.slug AS target_slug
     FROM workspace_merges m
     JOIN tenants s ON s.id = m.source_id
     JOIN tenants t ON t.id = m.target_id
     WHERE m.id = $1`,
    [mergeId]
  );
  if (!rows[0]) return null;
  const r = rows[0] as any;
  return {
    id: r.id,
    sourceId: r.source_id,
    targetId: r.target_id,
    sourceName: r.source_name,
    sourceSlug: r.source_slug,
    targetName: r.target_name,
    targetSlug: r.target_slug,
    initiatedBy: r.initiated_by,
    status: r.status,
    conflicts: r.conflict_data?.conflicts ?? [],
    stats: r.conflict_data?.stats ?? null,
    resolutions: r.resolutions?.items ?? [],
    summary: r.summary,
    errorMessage: r.error_message,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
}

/** Preview merge: scan both workspaces for conflicts. */
export async function previewMerge(mergeId: string, sourceId: string, targetId: string): Promise<ConflictReport> {
  const conflicts: MergeConflict[] = [];

  // ── Users: same email in both workspaces ──
  const { rows: userConflicts } = await pool.query(
    `SELECT
       su.id AS s_id, su.email AS s_email, su.first_name AS s_first, su.last_name AS s_last, su.role AS s_role,
       tu.id AS t_id, tu.email AS t_email, tu.first_name AS t_first, tu.last_name AS t_last, tu.role AS t_role
     FROM users su
     JOIN users tu ON LOWER(su.email) = LOWER(tu.email)
     WHERE su.tenant_id = $1 AND tu.tenant_id = $2
       AND su.deleted_at IS NULL AND tu.deleted_at IS NULL`,
    [sourceId, targetId]
  );

  for (const r of userConflicts) {
    const conflictingFields: string[] = [];
    if (r.s_first !== r.t_first) conflictingFields.push("firstName");
    if (r.s_last !== r.t_last) conflictingFields.push("lastName");
    if (r.s_role !== r.t_role) conflictingFields.push("role");

    conflicts.push({
      entityType: "user",
      sourceRecord: { id: r.s_id, label: `${r.s_first} ${r.s_last} (${r.s_email})`, fields: { firstName: r.s_first, lastName: r.s_last, email: r.s_email, role: r.s_role } },
      targetRecord: { id: r.t_id, label: `${r.t_first} ${r.t_last} (${r.t_email})`, fields: { firstName: r.t_first, lastName: r.t_last, email: r.t_email, role: r.t_role } },
      matchKey: r.s_email.toLowerCase(),
      conflictingFields,
    });
  }

  // ── Contacts: same email via person_email_index ──
  const { rows: contactConflicts } = await pool.query(
    `SELECT
       sp.email AS s_email, sp.node_id AS s_node_id,
       tp.email AS t_email, tp.node_id AS t_node_id
     FROM person_email_index sp
     JOIN person_email_index tp ON LOWER(sp.email) = LOWER(tp.email)
     WHERE sp.tenant_id = $1 AND tp.tenant_id = $2`,
    [sourceId, targetId]
  );

  for (const r of contactConflicts) {
    conflicts.push({
      entityType: "contact",
      sourceRecord: { id: r.s_node_id, label: r.s_email, fields: { email: r.s_email, nodeId: r.s_node_id } },
      targetRecord: { id: r.t_node_id, label: r.t_email, fields: { email: r.t_email, nodeId: r.t_node_id } },
      matchKey: r.s_email.toLowerCase(),
      conflictingFields: [],
    });
  }

  // ── Companies: same domain via company_domain_index ──
  const { rows: companyConflicts } = await pool.query(
    `SELECT
       sc.domain AS s_domain, sc.node_id AS s_node_id,
       tc.domain AS t_domain, tc.node_id AS t_node_id
     FROM company_domain_index sc
     JOIN company_domain_index tc ON LOWER(sc.domain) = LOWER(tc.domain)
     WHERE sc.tenant_id = $1 AND tc.tenant_id = $2`,
    [sourceId, targetId]
  );

  for (const r of companyConflicts) {
    conflicts.push({
      entityType: "company",
      sourceRecord: { id: r.s_node_id, label: r.s_domain, fields: { domain: r.s_domain, nodeId: r.s_node_id } },
      targetRecord: { id: r.t_node_id, label: r.t_domain, fields: { domain: r.t_domain, nodeId: r.t_node_id } },
      matchKey: r.s_domain.toLowerCase(),
      conflictingFields: [],
    });
  }

  // ── Sequences: same name in both workspaces ──
  const { rows: seqConflicts } = await pool.query(
    `SELECT
       ss.id AS s_id, ss.name AS s_name, ss.status AS s_status,
       ts.id AS t_id, ts.name AS t_name, ts.status AS t_status
     FROM sequences ss
     JOIN sequences ts ON LOWER(ss.name) = LOWER(ts.name)
     WHERE ss.tenant_id = $1 AND ts.tenant_id = $2`,
    [sourceId, targetId]
  );

  for (const r of seqConflicts) {
    conflicts.push({
      entityType: "sequence",
      sourceRecord: { id: r.s_id, label: r.s_name, fields: { name: r.s_name, status: r.s_status } },
      targetRecord: { id: r.t_id, label: r.t_name, fields: { name: r.t_name, status: r.t_status } },
      matchKey: r.s_name.toLowerCase(),
      conflictingFields: r.s_status !== r.t_status ? ["status"] : [],
    });
  }

  // ── Custom object definitions: same object_key ──
  const { rows: coConflicts } = await pool.query(
    `SELECT
       sc.id AS s_id, sc.object_key AS s_key, sc.label AS s_label,
       tc.id AS t_id, tc.object_key AS t_key, tc.label AS t_label
     FROM custom_object_definitions sc
     JOIN custom_object_definitions tc ON sc.object_key = tc.object_key
     WHERE sc.tenant_id = $1 AND tc.tenant_id = $2`,
    [sourceId, targetId]
  );

  for (const r of coConflicts) {
    conflicts.push({
      entityType: "custom_object",
      sourceRecord: { id: r.s_id, label: r.s_label ?? r.s_key, fields: { objectKey: r.s_key, label: r.s_label } },
      targetRecord: { id: r.t_id, label: r.t_label ?? r.t_key, fields: { objectKey: r.t_key, label: r.t_label } },
      matchKey: r.s_key,
      conflictingFields: r.s_label !== r.t_label ? ["label"] : [],
    });
  }

  // ── Counts for summary ──
  const count = async (table: string, tenantId: string) => {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    return rows[0]?.c ?? 0;
  };

  const [sUsers, tUsers, sDeals, tDeals, sSeqs, tSeqs, sCo, tCo] = await Promise.all([
    count("users", sourceId),
    count("users", targetId),
    pool.query(`SELECT COUNT(*)::int AS c FROM deal_signals WHERE tenant_id = $1`, [sourceId]).then((r: any) => r.rows[0]?.c ?? 0),
    pool.query(`SELECT COUNT(*)::int AS c FROM deal_signals WHERE tenant_id = $1`, [targetId]).then((r: any) => r.rows[0]?.c ?? 0),
    count("sequences", sourceId),
    count("sequences", targetId),
    count("custom_object_definitions", sourceId),
    count("custom_object_definitions", targetId),
  ]);

  const report: ConflictReport = {
    conflicts,
    stats: {
      users: { source: sUsers, target: tUsers, conflicts: userConflicts.length },
      contacts: { source: contactConflicts.length, target: contactConflicts.length, conflicts: contactConflicts.length },
      companies: { source: companyConflicts.length, target: companyConflicts.length, conflicts: companyConflicts.length },
      deals: { source: sDeals, target: tDeals },
      sequences: { source: sSeqs, target: tSeqs, conflicts: seqConflicts.length },
      customObjects: { source: sCo, target: tCo, conflicts: coConflicts.length },
    },
  };

  // Save conflict data to the merge record
  await pool.query(
    `UPDATE workspace_merges SET conflict_data = $2, status = 'pending' WHERE id = $1`,
    [mergeId, JSON.stringify(report)]
  );

  return report;
}

/** Save resolutions to the merge record. */
export async function saveResolutions(mergeId: string, resolutions: MergeResolution[]): Promise<void> {
  await pool.query(
    `UPDATE workspace_merges SET resolutions = $2, status = 'approved' WHERE id = $1`,
    [mergeId, JSON.stringify({ items: resolutions })]
  );
}

/** Execute the merge. Moves all data from source → target, applying resolutions. */
export async function executeMerge(mergeId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the merge row
    const { rows } = await client.query(
      `SELECT * FROM workspace_merges WHERE id = $1 FOR UPDATE`,
      [mergeId]
    );
    const merge = rows[0];
    if (!merge || merge.status !== "approved") {
      throw new Error(`Merge ${mergeId} is not in approved status`);
    }

    await client.query(
      `UPDATE workspace_merges SET status = 'in_progress' WHERE id = $1`,
      [mergeId]
    );

    const sourceId = merge.source_id;
    const targetId = merge.target_id;
    const resolutions: MergeResolution[] = merge.resolutions?.items ?? [];
    let moved = 0;
    let merged = 0;
    let skipped = 0;

    // ── Handle user conflicts ──
    const userResolutions = resolutions.filter(r => r.entityType === "user");
    for (const res of userResolutions) {
      if (res.action === "keep_target") {
        // Soft-delete source user with matching email
        await client.query(
          `UPDATE users SET deleted_at = NOW() WHERE tenant_id = $1 AND LOWER(email) = LOWER($2) AND deleted_at IS NULL`,
          [sourceId, res.matchKey]
        );
        skipped++;
      } else if (res.action === "keep_source") {
        // Soft-delete target, move source
        await client.query(
          `UPDATE users SET deleted_at = NOW() WHERE tenant_id = $1 AND LOWER(email) = LOWER($2) AND deleted_at IS NULL`,
          [targetId, res.matchKey]
        );
        await client.query(
          `UPDATE users SET tenant_id = $2 WHERE tenant_id = $1 AND LOWER(email) = LOWER($3) AND deleted_at IS NULL`,
          [sourceId, targetId, res.matchKey]
        );
        merged++;
      } else {
        // merge_fields: apply field overrides to target, delete source
        if (res.fieldOverrides) {
          for (const [field, choice] of Object.entries(res.fieldOverrides)) {
            if (choice === "source") {
              const colMap: Record<string, string> = { firstName: "first_name", lastName: "last_name", role: "role" };
              const col = colMap[field];
              if (col) {
                await client.query(
                  `UPDATE users SET ${col} = (SELECT ${col} FROM users WHERE tenant_id = $1 AND LOWER(email) = LOWER($3) AND deleted_at IS NULL LIMIT 1)
                   WHERE tenant_id = $2 AND LOWER(email) = LOWER($3) AND deleted_at IS NULL`,
                  [sourceId, targetId, res.matchKey]
                );
              }
            }
          }
        }
        await client.query(
          `UPDATE users SET deleted_at = NOW() WHERE tenant_id = $1 AND LOWER(email) = LOWER($2) AND deleted_at IS NULL`,
          [sourceId, res.matchKey]
        );
        merged++;
      }
    }

    // ── Move non-conflicting users ──
    const conflictEmails = userResolutions.map(r => r.matchKey.toLowerCase());
    if (conflictEmails.length > 0) {
      const { rowCount } = await client.query(
        `UPDATE users SET tenant_id = $2 WHERE tenant_id = $1 AND deleted_at IS NULL AND LOWER(email) != ALL($3::text[])`,
        [sourceId, targetId, conflictEmails]
      );
      moved += rowCount ?? 0;
    } else {
      const { rowCount } = await client.query(
        `UPDATE users SET tenant_id = $2 WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [sourceId, targetId]
      );
      moved += rowCount ?? 0;
    }

    // ── Move bulk data tables (non-conflicting — just update tenant_id) ──
    const bulkTables = [
      "crm_events", "audit_log", "review_queue", "integrations",
      "deal_signals", "deal_score_snapshots",
      "email_threads", "email_messages", "phone_calls",
      "products", "quotes",
      "report_datasets", "reports",
      "import_jobs", "enrichment_jobs",
      "tasks",
    ];

    for (const table of bulkTables) {
      try {
        const { rowCount } = await client.query(
          `UPDATE ${table} SET tenant_id = $2 WHERE tenant_id = $1`,
          [sourceId, targetId]
        );
        moved += rowCount ?? 0;
      } catch {
        // Table may not exist in this deployment; skip gracefully
      }
    }

    // ── Handle contact/company conflicts (keep target by default, remap references) ──
    // For simplicity: contacts/companies that conflict are skipped (target version kept),
    // non-conflicting ones are moved via index tables
    const contactRes = resolutions.filter(r => r.entityType === "contact");
    const companyRes = resolutions.filter(r => r.entityType === "company");

    // Move non-conflicting person_email_index entries
    const contactConflictKeys = contactRes.map(r => r.matchKey.toLowerCase());
    if (contactConflictKeys.length > 0) {
      await client.query(
        `UPDATE person_email_index SET tenant_id = $2 WHERE tenant_id = $1 AND LOWER(email) != ALL($3::text[])`,
        [sourceId, targetId, contactConflictKeys]
      );
    } else {
      await client.query(
        `UPDATE person_email_index SET tenant_id = $2 WHERE tenant_id = $1`,
        [sourceId, targetId]
      );
    }

    // Move non-conflicting company_domain_index entries
    const companyConflictKeys = companyRes.map(r => r.matchKey.toLowerCase());
    if (companyConflictKeys.length > 0) {
      await client.query(
        `UPDATE company_domain_index SET tenant_id = $2 WHERE tenant_id = $1 AND LOWER(domain) != ALL($3::text[])`,
        [sourceId, targetId, companyConflictKeys]
      );
    } else {
      await client.query(
        `UPDATE company_domain_index SET tenant_id = $2 WHERE tenant_id = $1`,
        [sourceId, targetId]
      );
    }

    // ── Move sequence data ──
    const seqConflictKeys = resolutions.filter(r => r.entityType === "sequence").map(r => r.matchKey.toLowerCase());
    if (seqConflictKeys.length > 0) {
      await client.query(
        `UPDATE sequences SET tenant_id = $2 WHERE tenant_id = $1 AND LOWER(name) != ALL($3::text[])`,
        [sourceId, targetId, seqConflictKeys]
      );
    } else {
      await client.query(
        `UPDATE sequences SET tenant_id = $2 WHERE tenant_id = $1`,
        [sourceId, targetId]
      );
    }

    // ── Move custom object definitions ──
    const coConflictKeys = resolutions.filter(r => r.entityType === "custom_object").map(r => r.matchKey);
    if (coConflictKeys.length > 0) {
      await client.query(
        `UPDATE custom_object_definitions SET tenant_id = $2 WHERE tenant_id = $1 AND object_key != ALL($3::text[])`,
        [sourceId, targetId, coConflictKeys]
      );
    } else {
      await client.query(
        `UPDATE custom_object_definitions SET tenant_id = $2 WHERE tenant_id = $1`,
        [sourceId, targetId]
      );
    }

    // ── Merge usage stats ──
    await client.query(
      `INSERT INTO workspace_usage_stats (tenant_id, period, api_calls, ai_events, ai_tokens, emails_sent, calls_made, storage_bytes)
       SELECT $2, period, api_calls, ai_events, ai_tokens, emails_sent, calls_made, storage_bytes
       FROM workspace_usage_stats WHERE tenant_id = $1
       ON CONFLICT (tenant_id, period) DO UPDATE SET
         api_calls = workspace_usage_stats.api_calls + EXCLUDED.api_calls,
         ai_events = workspace_usage_stats.ai_events + EXCLUDED.ai_events,
         ai_tokens = workspace_usage_stats.ai_tokens + EXCLUDED.ai_tokens,
         emails_sent = workspace_usage_stats.emails_sent + EXCLUDED.emails_sent,
         calls_made = workspace_usage_stats.calls_made + EXCLUDED.calls_made,
         storage_bytes = workspace_usage_stats.storage_bytes + EXCLUDED.storage_bytes`,
      [sourceId, targetId]
    );

    // ── Soft-delete source tenant ──
    await client.query(
      `UPDATE tenants SET deleted_at = NOW() WHERE id = $1`,
      [sourceId]
    );

    // ── Complete the merge ──
    await client.query(
      `UPDATE workspace_merges SET status = 'completed', summary = $2, completed_at = NOW() WHERE id = $1`,
      [mergeId, JSON.stringify({ moved, merged, skipped })]
    );

    await client.query("COMMIT");
  } catch (err: any) {
    await client.query("ROLLBACK");
    await pool.query(
      `UPDATE workspace_merges SET status = 'failed', error_message = $2 WHERE id = $1`,
      [mergeId, err.message]
    );
    throw err;
  } finally {
    client.release();
  }
}

/** Cancel a pending or previewing merge. */
export async function cancelMerge(mergeId: string): Promise<void> {
  await pool.query(
    `UPDATE workspace_merges SET status = 'cancelled' WHERE id = $1 AND status IN ('pending', 'previewing', 'approved')`,
    [mergeId]
  );
}
