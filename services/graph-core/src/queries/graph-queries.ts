/**
 * Named graph queries — all Cypher queries for the NexCRM graph.
 * These are parameterized and called via the graph-core service.
 *
 * Examples of the graph-first model in action:
 *   - stalling deals
 *   - ego network for a contact
 *   - intro path between two people
 *   - buying group composition
 */

import { cypher } from "../db/pool";

/**
 * Find deals with no activity in the last N days.
 * "Deals losing momentum" — a query Salesforce SOQL can't express in one pass.
 */
export async function getStallingDeals(tenantId: string, daysSilent = 7) {
  return cypher(`
    MATCH (d:Deal {tenant_id: '${tenantId}'})
    OPTIONAL MATCH (d)-[:HAS_ACTIVITY]->(a:Activity)
    WITH d, MAX(a.occurred_at) AS last_activity
    WHERE last_activity IS NULL OR last_activity < datetime() - duration({days: ${daysSilent}})
    AND d.stage NOT IN ['closed_won', 'closed_lost']
    RETURN d, last_activity
    ORDER BY last_activity ASC
  `);
}

/**
 * Get ego network: all nodes within N hops of a given entity.
 */
export async function getEgoNetwork(nodeId: string, depth = 2) {
  return cypher(`
    MATCH path = (center {id: '${nodeId}'})-[*1..${depth}]-(neighbor)
    RETURN DISTINCT neighbor, relationships(path) AS rels
    LIMIT 200
  `);
}

/**
 * Shortest introduction path between two people.
 * "Who can introduce me to the CTO of Acme?"
 */
export async function getIntroPath(fromId: string, toId: string) {
  return cypher(`
    MATCH path = shortestPath(
      (a {id: '${fromId}'})-[:KNOWS*..5]-(b {id: '${toId}'})
    )
    RETURN path, length(path) AS hops
  `);
}

/**
 * Buying group composition for a deal.
 * Returns all people with roles in the buying group.
 */
export async function getBuyingGroup(dealId: string) {
  return cypher(`
    MATCH (p:Person)-[r:INFLUENCES]->(d:Deal {id: '${dealId}'})
    RETURN p, r.role AS role, r.influence_score AS influence_score, r.sentiment AS sentiment
    ORDER BY r.influence_score DESC
  `);
}

/**
 * At-risk accounts: companies where sentiment has declined or activity dropped.
 */
export async function getAtRiskAccounts(tenantId: string) {
  return cypher(`
    MATCH (c:Company {tenant_id: '${tenantId}'})<-[:WORKS_AT]-(p:Person)
    MATCH (p)-[:PARTICIPATED_IN]->(a:Activity)
    WITH c, AVG(a.sentiment) AS avg_sentiment, MAX(a.occurred_at) AS last_contact
    WHERE avg_sentiment < -0.2 OR last_contact < datetime() - duration({days: 30})
    RETURN c, avg_sentiment, last_contact
    ORDER BY avg_sentiment ASC
    LIMIT 20
  `);
}

/**
 * Contacts who have gone dark (no response in N days).
 */
export async function getDarkContacts(tenantId: string, daysDark = 7) {
  return cypher(`
    MATCH (p:Person {tenant_id: '${tenantId}'})-[:PARTICIPATED_IN]->(a:Activity)
    WITH p, MAX(a.occurred_at) AS last_activity
    WHERE last_activity < datetime() - duration({days: ${daysDark}})
    RETURN p, last_activity
    ORDER BY last_activity ASC
    LIMIT 50
  `);
}

/**
 * Create or update a Person node (upsert by email within tenant).
 */
export async function upsertPerson(tenantId: string, person: Record<string, unknown>) {
  return cypher(`
    MERGE (p:Person {tenant_id: '${tenantId}', email: '${person.email}'})
    ON CREATE SET
      p.id = '${person.id ?? crypto.randomUUID()}',
      p.first_name = '${person.firstName}',
      p.last_name = '${person.lastName}',
      p.title = '${person.title ?? ""}',
      p.created_at = datetime()
    ON MATCH SET
      p.first_name = COALESCE('${person.firstName}', p.first_name),
      p.last_name = COALESCE('${person.lastName}', p.last_name),
      p.updated_at = datetime()
    RETURN p
  `);
}

/**
 * Link a person to a deal with a role edge.
 */
export async function linkPersonToDeal(
  personId: string,
  dealId: string,
  role: string,
  influenceScore: number
) {
  return cypher(`
    MATCH (p:Person {id: '${personId}'})
    MATCH (d:Deal {id: '${dealId}'})
    MERGE (p)-[r:INFLUENCES]->(d)
    SET r.role = '${role}',
        r.influence_score = ${influenceScore},
        r.updated_at = datetime()
    RETURN r
  `);
}
