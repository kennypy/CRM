/**
 * Named graph queries — all Cypher queries for the NexCRM graph.
 * These are parameterized and called via the graph-core service.
 *
 * Examples of the graph-first model in action:
 *   - stalling deals
 *   - ego network for a contact
 *   - intro path between two people
 *   - buying group composition
 *
 * Security: all Cypher uses named $params — no string interpolation.
 * Integer literals (depth, daysSilent, daysDark) are safe to embed because
 * they are validated to be integers before reaching these functions, and
 * Cypher range/duration syntax does not support parameter references.
 */

import { cypher } from "../db/pool";

/**
 * Find deals with no activity in the last N days.
 * daysSilent is a validated integer from the route handler.
 */
export async function getStallingDeals(tenantId: string, daysSilent = 7) {
  return cypher(
    `MATCH (d:Deal {tenant_id: $tenantId})
     OPTIONAL MATCH (a:Activity)-[:RELATED_TO]->(d)
     WITH d, MAX(a.occurred_at) AS last_activity
     WHERE (last_activity IS NULL OR last_activity < datetime() - duration({days: ${daysSilent}}))
       AND NOT d.stage IN ['closed_won', 'closed_lost']
     RETURN {
       id: d.id, tenant_id: d.tenant_id, name: d.name, stage: d.stage,
       value: d.value, last_activity: last_activity
     }
     ORDER BY last_activity ASC`,
    { tenantId }
  );
}

/**
 * Get ego network: all nodes within N hops of a given entity.
 * depth is a validated integer — Cypher range syntax [*1..N] requires a literal.
 * SECURITY: both center and neighbor are scoped to tenantId to prevent
 * cross-tenant graph traversal (a node in tenant A must not reach tenant B).
 */
export async function getEgoNetwork(nodeId: string, tenantId: string, depth = 2) {
  return cypher(
    `MATCH path = (center {id: $nodeId, tenant_id: $tenantId})-[*1..${depth}]-(neighbor {tenant_id: $tenantId})
     RETURN DISTINCT {id: neighbor.id, label: labels(neighbor)[0]}
     LIMIT 200`,
    { nodeId, tenantId }
  );
}

/**
 * Shortest introduction path between two people.
 * "Who can introduce me to the CTO of Acme?"
 * SECURITY: both endpoints are scoped to tenantId — prevents cross-tenant
 * path discovery via KNOWS edge traversal.
 */
export async function getIntroPath(fromId: string, toId: string, tenantId: string) {
  return cypher(
    `MATCH path = shortestPath(
       (a {id: $fromId, tenant_id: $tenantId})-[:KNOWS*..5]-(b {id: $toId, tenant_id: $tenantId})
     )
     RETURN {hops: length(path)}`,
    { fromId, toId, tenantId }
  );
}

/**
 * Buying group composition for a deal.
 * Returns all people with roles in the buying group.
 * tenantId added to scope the Deal lookup.
 */
export async function getBuyingGroup(dealId: string, tenantId: string) {
  return cypher(
    `MATCH (p:Person)-[r:INFLUENCES]->(d:Deal {id: $dealId, tenant_id: $tenantId})
     RETURN {
       person_id: p.id,
       first_name: p.first_name, last_name: p.last_name, email: p.email,
       role: r.role, influence_score: r.influence_score, sentiment: r.sentiment
     }
     ORDER BY r.influence_score DESC`,
    { dealId, tenantId }
  );
}

/**
 * At-risk accounts: companies where sentiment has declined or activity dropped.
 */
export async function getAtRiskAccounts(tenantId: string) {
  return cypher(
    `MATCH (c:Company {tenant_id: $tenantId})<-[:WORKS_AT]-(p:Person)
     MATCH (p)-[:PARTICIPATED_IN]->(a:Activity)
     WITH c, AVG(a.sentiment) AS avg_sentiment, MAX(a.occurred_at) AS last_contact
     WHERE avg_sentiment < -0.2 OR last_contact < datetime() - duration({days: 30})
     RETURN {
       id: c.id, name: c.name, domain: c.domain,
       avg_sentiment: avg_sentiment, last_contact: last_contact
     }
     ORDER BY avg_sentiment ASC
     LIMIT 20`,
    { tenantId }
  );
}

/**
 * Contacts who have gone dark (no activity in N days).
 * daysDark is a validated integer — Cypher duration syntax requires a literal.
 */
export async function getDarkContacts(tenantId: string, daysDark = 7) {
  return cypher(
    `MATCH (p:Person {tenant_id: $tenantId})-[:PARTICIPATED_IN]->(a:Activity)
     WITH p, MAX(a.occurred_at) AS last_activity
     WHERE last_activity < datetime() - duration({days: ${daysDark}})
     RETURN {
       id: p.id, first_name: p.first_name, last_name: p.last_name,
       email: p.email, last_activity: last_activity
     }
     ORDER BY last_activity ASC
     LIMIT 50`,
    { tenantId }
  );
}

/**
 * Create or update a Person node (upsert by email within tenant).
 * All values via $params.
 */
export async function upsertPerson(tenantId: string, person: Record<string, unknown>) {
  const id  = (person.id as string | undefined) ?? crypto.randomUUID();
  return cypher(
    `MERGE (p:Person {tenant_id: $tenantId, email: $email})
     ON CREATE SET
       p.id         = $id,
       p.first_name = $firstName,
       p.last_name  = $lastName,
       p.title      = $title,
       p.created_at = $now
     ON MATCH SET
       p.first_name = $firstName,
       p.last_name  = $lastName,
       p.updated_at = $now
     RETURN {id: p.id}`,
    {
      tenantId,
      email:     person.email     as string,
      id,
      firstName: person.firstName as string ?? "",
      lastName:  person.lastName  as string ?? "",
      title:     person.title     as string ?? "",
      now:       new Date().toISOString(),
    }
  );
}

/**
 * Link a person to a deal with a role edge.
 */
export async function linkPersonToDeal(
  personId:       string,
  dealId:         string,
  role:           string,
  influenceScore: number,
) {
  return cypher(
    `MATCH (p:Person {id: $personId})
     MATCH (d:Deal {id: $dealId})
     MERGE (p)-[r:INFLUENCES]->(d)
     SET r.role            = $role,
         r.influence_score = $influenceScore,
         r.updated_at      = $now
     RETURN {ok: true}`,
    { personId, dealId, role, influenceScore, now: new Date().toISOString() }
  );
}
