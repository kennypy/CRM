/**
 * Core types for the graph client.
 *
 * These mirror the AGE graph model used by graph-core, but are kept
 * self-contained so consumers don't need to depend on shared-types
 * for basic graph operations.
 */

// ── Node ─────────────────────────────────────────────────────────────────────

export interface GraphNode<P extends Record<string, unknown> = Record<string, unknown>> {
  /** Application-level UUID (not the AGE internal id). */
  id: string;
  /** Node label (Person, Company, Deal, Activity, etc.). */
  label: string;
  /** All properties stored on the node. */
  properties: P;
}

// ── Edge ─────────────────────────────────────────────────────────────────────

export interface GraphEdge<P extends Record<string, unknown> = Record<string, unknown>> {
  /** Edge label (WORKS_AT, KNOWS, INFLUENCES, etc.). */
  label: string;
  /** Source node id. */
  fromId: string;
  /** Target node id. */
  toId: string;
  /** All properties stored on the edge. */
  properties: P;
}

// ── Cypher result ────────────────────────────────────────────────────────────

export interface CypherResult<T = Record<string, unknown>> {
  /** Parsed rows returned by the Cypher query. */
  rows: T[];
  /** Number of rows returned. */
  rowCount: number;
}

// ── Direction for edge traversal ─────────────────────────────────────────────

export type EdgeDirection = "outgoing" | "incoming" | "both";

// ── Filter map for findNode ──────────────────────────────────────────────────

export type NodeFilters = Record<string, unknown>;
