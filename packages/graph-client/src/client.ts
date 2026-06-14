/**
 * GraphClient — typed wrapper around Apache AGE Cypher queries.
 *
 * Takes a pg Pool and executes Cypher via `ag_catalog.cypher()`,
 * matching the pattern used by services/graph-core/src/db/pool.ts.
 *
 * All queries use named $params (JSON-serialized) — no string
 * interpolation of user-supplied values.
 */

import type { Pool, PoolClient } from "pg";
import type {
  GraphNode,
  GraphEdge,
  CypherResult,
  EdgeDirection,
  NodeFilters,
} from "./types";

/** Default AGE graph name. Override via constructor options. */
const DEFAULT_GRAPH_NAME = "nexcrm_graph";

export interface GraphClientOptions {
  /** Name of the AGE graph (default: "nexcrm_graph"). */
  graphName?: string;
}

export class GraphClient {
  private readonly pool: Pool;
  private readonly graphName: string;

  constructor(pool: Pool, options?: GraphClientOptions) {
    this.pool = pool;
    this.graphName = options?.graphName ?? DEFAULT_GRAPH_NAME;
  }

  // ── Low-level Cypher execution ───────────────────────────────────────────

  /**
   * Execute a raw Cypher query via Apache AGE.
   *
   * The query is sent through `ag_catalog.cypher()` with params
   * serialized as a single agtype JSON argument.
   *
   * ```ts
   * const result = await client.runCypher<{ id: string; name: string }>(
   *   'MATCH (c:Company {tenant_id: $tenantId}) RETURN {id: c.id, name: c.name}',
   *   { tenantId: 'abc' },
   * );
   * ```
   */
  async runCypher<T = Record<string, unknown>>(
    query: string,
    params: Record<string, unknown> = {},
  ): Promise<CypherResult<T>> {
    const client = await this.pool.connect();
    try {
      return await this.executeCypher<T>(client, query, params);
    } finally {
      client.release();
    }
  }

  // ── Node operations ──────────────────────────────────────────────────────

  /**
   * Create a node with the given label and properties.
   *
   * Returns the created node's properties as returned by Cypher.
   *
   * ```ts
   * const node = await client.createNode('Person', {
   *   id: crypto.randomUUID(),
   *   tenant_id: tenantId,
   *   first_name: 'Ada',
   *   last_name: 'Lovelace',
   *   email: 'ada@example.com',
   *   created_at: new Date().toISOString(),
   *   updated_at: new Date().toISOString(),
   * });
   * ```
   */
  async createNode<P extends Record<string, unknown> = Record<string, unknown>>(
    label: string,
    properties: P,
  ): Promise<GraphNode<P>> {
    this.validateLabel(label);

    // Build property assignments from param keys
    const propEntries = Object.keys(properties);
    this.validatePropertyKeys(propEntries);
    const propAssignments = propEntries
      .map((key) => `${key}: $${key}`)
      .join(", ");

    // Build a RETURN map so we get all properties back
    const returnFields = propEntries
      .map((key) => `${key}: n.${key}`)
      .join(", ");

    const query = `CREATE (n:${label} {${propAssignments}}) RETURN {${returnFields}}`;

    const result = await this.runCypher<P>(query, properties);
    return {
      id: (properties.id as string) ?? "",
      label,
      properties: result.rows[0] ?? (properties as P),
    };
  }

  /**
   * Find nodes matching a label and optional property filters.
   *
   * ```ts
   * const people = await client.findNode('Person', {
   *   tenant_id: tenantId,
   *   email: 'ada@example.com',
   * });
   * ```
   */
  async findNode<P extends Record<string, unknown> = Record<string, unknown>>(
    label: string,
    filters: NodeFilters = {},
  ): Promise<GraphNode<P>[]> {
    this.validateLabel(label);

    const filterKeys = Object.keys(filters);
    this.validatePropertyKeys(filterKeys);
    let matchClause: string;

    if (filterKeys.length > 0) {
      const filterProps = filterKeys
        .map((key) => `${key}: $${key}`)
        .join(", ");
      matchClause = `MATCH (n:${label} {${filterProps}})`;
    } else {
      matchClause = `MATCH (n:${label})`;
    }

    const query = `${matchClause} RETURN properties(n)`;

    const result = await this.runCypher<P>(query, filters);
    return result.rows.map((row) => ({
      id: (row as Record<string, unknown>).id as string ?? "",
      label,
      properties: row,
    }));
  }

  // ── Edge operations ──────────────────────────────────────────────────────

  /**
   * Create an edge between two nodes identified by their `id` property.
   *
   * ```ts
   * await client.createEdge(personId, companyId, 'WORKS_AT', {
   *   is_current: true,
   *   created_at: new Date().toISOString(),
   * });
   * ```
   */
  async createEdge<P extends Record<string, unknown> = Record<string, unknown>>(
    fromId: string,
    toId: string,
    label: string,
    properties: P = {} as P,
  ): Promise<GraphEdge<P>> {
    this.validateLabel(label);

    const propEntries = Object.keys(properties);
    this.validatePropertyKeys(propEntries);
    const propAssignments = propEntries.length > 0
      ? ` {${propEntries.map((key) => `${key}: $${key}`).join(", ")}}`
      : "";

    const returnFields = propEntries.length > 0
      ? propEntries.map((key) => `${key}: r.${key}`).join(", ")
      : "created: true";

    const query =
      `MATCH (a {id: $fromId}), (b {id: $toId})
       CREATE (a)-[r:${label}${propAssignments}]->(b)
       RETURN {${returnFields}}`;

    await this.runCypher(query, { fromId, toId, ...properties });
    return {
      label,
      fromId,
      toId,
      properties,
    };
  }

  /**
   * Find edges connected to a node.
   *
   * @param nodeId    - The `id` property of the node.
   * @param edgeLabel - Optional edge label filter (e.g. "WORKS_AT").
   * @param direction - "outgoing" | "incoming" | "both" (default: "both").
   */
  async findEdges<P extends Record<string, unknown> = Record<string, unknown>>(
    nodeId: string,
    edgeLabel?: string,
    direction: EdgeDirection = "both",
  ): Promise<GraphEdge<P>[]> {
    if (edgeLabel) this.validateLabel(edgeLabel);

    const labelFilter = edgeLabel ? `:${edgeLabel}` : "";

    let query: string;
    switch (direction) {
      case "outgoing":
        query =
          `MATCH (a {id: $nodeId})-[r${labelFilter}]->(b)
           RETURN {fromId: a.id, toId: b.id, label: type(r), properties: properties(r)}`;
        break;
      case "incoming":
        query =
          `MATCH (a {id: $nodeId})<-[r${labelFilter}]-(b)
           RETURN {fromId: b.id, toId: a.id, label: type(r), properties: properties(r)}`;
        break;
      case "both":
      default:
        query =
          `MATCH (a {id: $nodeId})-[r${labelFilter}]-(b)
           RETURN {fromId: a.id, toId: b.id, label: type(r), properties: properties(r)}`;
        break;
    }

    const result = await this.runCypher<{
      fromId: string;
      toId: string;
      label: string;
      properties: P;
    }>(query, { nodeId });

    return result.rows.map((row) => ({
      label: row.label,
      fromId: row.fromId,
      toId: row.toId,
      properties: row.properties ?? ({} as P),
    }));
  }

  // ── Graph traversal ──────────────────────────────────────────────────────

  /**
   * Find the shortest path between two nodes.
   *
   * Uses Cypher `shortestPath` with a configurable max depth
   * and optional relationship type filter.
   *
   * ```ts
   * const path = await client.findShortestPath(personA, personB);
   * // => { hops: 3, path: [{id, label}, ...] }
   * ```
   */
  async findShortestPath(
    fromId: string,
    toId: string,
    options?: { maxDepth?: number; edgeLabel?: string },
  ): Promise<{ hops: number; nodeIds: string[] }> {
    const maxDepth = options?.maxDepth ?? 5;
    const relFilter = options?.edgeLabel ? `:${options.edgeLabel}` : "";

    if (options?.edgeLabel) this.validateLabel(options.edgeLabel);

    // depth is a validated integer — Cypher range syntax requires a literal
    const query =
      `MATCH path = shortestPath(
         (a {id: $fromId})-[${relFilter}*..${maxDepth}]-(b {id: $toId})
       )
       RETURN {hops: length(path), nodeIds: [n IN nodes(path) | n.id]}`;

    const result = await this.runCypher<{ hops: number; nodeIds: string[] }>(
      query,
      { fromId, toId },
    );

    if (result.rows.length === 0) {
      return { hops: -1, nodeIds: [] };
    }

    return {
      hops: result.rows[0].hops,
      nodeIds: result.rows[0].nodeIds ?? [],
    };
  }

  /**
   * Find all neighbors within N hops of a node.
   *
   * Matches the ego-network pattern from graph-core.
   *
   * ```ts
   * const neighbors = await client.findNeighbors(contactId, 2);
   * ```
   */
  async findNeighbors(
    nodeId: string,
    depth: number = 2,
    options?: { tenantId?: string; limit?: number },
  ): Promise<Array<{ id: string; label: string }>> {
    const limit = options?.limit ?? 200;

    // Build tenant scoping if provided — prevents cross-tenant traversal
    const neighborFilter = options?.tenantId
      ? `{tenant_id: $tenantId}`
      : "";
    const centerFilter = options?.tenantId
      ? `{id: $nodeId, tenant_id: $tenantId}`
      : `{id: $nodeId}`;

    const params: Record<string, unknown> = { nodeId };
    if (options?.tenantId) {
      params.tenantId = options.tenantId;
    }

    // depth is a validated integer — Cypher range syntax requires a literal
    const query =
      `MATCH path = (center ${centerFilter})-[*1..${depth}]-(neighbor ${neighborFilter})
       RETURN DISTINCT {id: neighbor.id, label: labels(neighbor)[0]}
       LIMIT ${limit}`;

    const result = await this.runCypher<{ id: string; label: string }>(
      query,
      params,
    );

    return result.rows;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Execute Cypher on an already-acquired client connection.
   * Handles LOAD 'age', search_path setup, and JSON param serialization.
   */
  private async executeCypher<T>(
    client: PoolClient,
    query: string,
    params: Record<string, unknown>,
  ): Promise<CypherResult<T>> {
    await client.query("LOAD 'age'");
    await client.query("SET search_path = ag_catalog, \"$user\", public");

    const paramStr = JSON.stringify(params);
    const result = await client.query(
      `SELECT * FROM cypher('${this.graphName}', $$ ${query} $$, $1::agtype) AS result(v agtype)`,
      [paramStr],
    );

    const rows = result.rows.map((r: { v: string }) =>
      JSON.parse(r.v) as T,
    );

    return { rows, rowCount: rows.length };
  }

  /**
   * Validate that a label contains only safe characters.
   * Labels are embedded as Cypher identifiers (not parameterizable),
   * so we restrict them to alphanumeric + underscore.
   */
  private validateLabel(label: string): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) {
      throw new Error(
        `Invalid label "${label}": must match /^[A-Za-z_][A-Za-z0-9_]*$/`,
      );
    }
  }

  /**
   * Validate property keys before they are interpolated as Cypher identifiers.
   * Property VALUES are parameterized ($key), but the KEYS are written into the
   * query string, so an attacker-influenced key (e.g. from a request-derived
   * filter map) could otherwise break out and inject Cypher. Restrict to the
   * same identifier grammar as labels.
   */
  private validatePropertyKeys(keys: string[]): void {
    for (const key of keys) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(
          `Invalid property key "${key}": must match /^[A-Za-z_][A-Za-z0-9_]*$/`,
        );
      }
    }
  }
}
