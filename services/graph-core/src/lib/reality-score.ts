/**
 * Deterministic Reality Score engine — v1
 *
 * Four pillars, two archetypes (simple / complex).
 * No AI inference — every score is derivable from the evidence list.
 *
 * Fix 1: Structural uses ICP-fit (expansion vs new + profile completeness).
 *        No tier-size ranking (enterprise ≠ better).
 * Fix 2: Momentum decay half-life is archetype-specific:
 *        simple  → expectedDays 30, half-life 7.5 d
 *        complex → expectedDays 60, half-life 15 d
 * Fix 3: Buying-group deficit penalty scales linearly; sentiment capped ±10.
 * Fix 4: No days-to-close "urgency" — close dates are rep-entered garbage.
 * Fix 5: deal_signals table uses deal_uuid UUID (never AGE internal id).
 * Fix 6: Snapshot written on every computation; trend compares against the
 *        most-recent snapshot that is at least 24 h old (responsive yet stable).
 * Fix 7: Email direction uses a.direction field — never inferred from sentiment.
 * Fix 8: All Cypher calls use $params — no string interpolation.
 */

import { pool, cypher } from "../db/pool";

// ── Archetype constants ───────────────────────────────────────────────────────

const ARCHETYPES = {
  simple:  { expectedDays: 30, expectedStakeholders: 2 },
  complex: { expectedDays: 60, expectedStakeholders: 4 },
} as const;

// ── Commercial watermarks (highest tier achieved wins) ────────────────────────

const COMMERCIAL_WATERMARKS: Record<string, number> = {
  pricing_mentioned: 25,
  quote_requested:   40,
  quote_sent:        55,
  quote_opened:      65,
  contract_sent:     80,
  contract_opened:   90,
};

// ── Activity weights for momentum ─────────────────────────────────────────────
// email_inbound / email_outbound are separate keys mapped from a.direction.
// Activities without a direction default to email_outbound (lower weight).

const ACTIVITY_WEIGHTS: Record<string, number> = {
  meeting:        25,
  call:           20,
  email_inbound:  18,
  email_outbound: 10,
  document:       12,
  note:            5,
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PillarResult {
  score:    number;
  evidence: string[];
}

export interface ScoreResult {
  score:     number;
  archetype: "simple" | "complex";
  pillars: {
    momentum:     PillarResult;
    commercial:   PillarResult;
    buying_group: PillarResult;
    structural:   PillarResult;
  };
  weights: {
    momentum: number; commercial: number;
    buying_group: number; structural: number;
  };
  trend:       "up" | "down" | "flat";
  trendDelta:  number;
  explanation: string;
  computedAt:  string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function expDecay(daysAgo: number, halfLife: number): number {
  return Math.exp(-Math.LN2 * daysAgo / halfLife);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ── Pillar 1: Momentum ────────────────────────────────────────────────────────
// Fix 7: email direction comes from a.direction, not sentiment proxy.

function scoreMomentum(
  activities: Array<{ type: string; direction: string | null; occurredAt: string }>,
  archetype:  "simple" | "complex",
): PillarResult {
  const { expectedDays } = ARCHETYPES[archetype];
  const halfLife  = expectedDays * 0.25;            // simple: 7.5 d | complex: 15 d
  const windowMs  = expectedDays * 2 * 86_400_000;  // simple: 60 d  | complex: 120 d
  const now       = Date.now();
  let   raw       = 0;
  const evidence: string[] = [];

  for (const act of activities) {
    const ts = new Date(act.occurredAt).getTime();
    if (isNaN(ts) || now - ts > windowMs) continue;

    // Fix 7: use explicit direction field — never infer from sentiment
    let key = act.type;
    if (act.type === "email") {
      key = act.direction === "inbound" ? "email_inbound" : "email_outbound";
    }

    const weight  = ACTIVITY_WEIGHTS[key] ?? 5;
    const daysAgo = (now - ts) / 86_400_000;
    const contrib = weight * expDecay(daysAgo, halfLife);
    raw += contrib;

    if (evidence.length < 5) {
      const dir = key === "email_inbound" ? "inbound " : key === "email_outbound" ? "outbound " : "";
      evidence.push(`${dir}${act.type} ${Math.round(daysAgo)}d ago (+${contrib.toFixed(1)})`);
    }
  }

  return { score: clamp(Math.round(raw), 0, 100), evidence };
}

// ── Pillar 2: Commercial Intent ───────────────────────────────────────────────

function scoreCommercial(
  signals: Array<{ signalType: string; occurredAt: string }>,
): PillarResult {
  let   best     = 0;
  const evidence: string[] = [];

  for (const sig of signals) {
    const mark = COMMERCIAL_WATERMARKS[sig.signalType] ?? 0;
    if (mark > best) best = mark;
    evidence.push(`${sig.signalType} (${sig.occurredAt.slice(0, 10)})`);
  }

  if (evidence.length === 0) evidence.push("No commercial signals recorded");

  return { score: best, evidence };
}

// ── Pillar 3: Buying Group ────────────────────────────────────────────────────
// Linear deficit penalty (×8 per missing person), sentiment capped ±10.

function scoreBuyingGroup(
  stakeholders: Array<{ role: string; sentiment: number }>,
  archetype:    "simple" | "complex",
): PillarResult {
  const expected = ARCHETYPES[archetype].expectedStakeholders;
  const actual   = stakeholders.length;

  const avgSentiment = actual > 0
    ? stakeholders.reduce((s, p) => s + (p.sentiment ?? 0), 0) / actual
    : 0;

  const coverageBase   = Math.min(actual / expected, 1.0) * 80;
  const deficitPenalty = Math.max(0, expected - actual) * 8;
  const sentimentAdj   = clamp(avgSentiment * 10, -10, 10);

  const score = clamp(Math.round(coverageBase - deficitPenalty + sentimentAdj), 0, 100);

  const evidence: string[] = [
    `${actual}/${expected} expected stakeholders for ${archetype} deal`,
    ...stakeholders.map((s) =>
      `${s.role}: sentiment ${s.sentiment >= 0 ? "+" : ""}${s.sentiment.toFixed(2)}`
    ),
  ];
  if (actual === 0) evidence.push("No stakeholders linked — single-thread risk");

  return { score, evidence };
}

// ── Pillar 4: Structural Context ──────────────────────────────────────────────
// ICP-fit: expansion vs new + profile completeness. No tier ranking, no dates.

function scoreStructural(
  company:     { industry?: string; headcount?: number } | null,
  isExpansion: boolean,
): PillarResult {
  const accountScore      = isExpansion ? 40 : 20;
  const completenessScore = (company?.industry && (company.headcount ?? 0) > 0) ? 20 : 0;
  const score             = accountScore + completenessScore; // range 20–60

  const evidence: string[] = [
    isExpansion ? "Existing customer (expansion)" : "New business",
    company?.industry          ? `Industry: ${company.industry}` : "Industry not set",
    (company?.headcount ?? 0) > 0 ? `Headcount: ${company.headcount}` : "Headcount unknown",
  ];

  return { score, evidence };
}

// ── Explanation builder ───────────────────────────────────────────────────────

function buildExplanation(score: number, m: PillarResult, c: PillarResult, bg: PillarResult): string {
  const parts: string[] = [];

  if      (m.score >= 60) parts.push("strong engagement cadence");
  else if (m.score >= 30) parts.push("moderate engagement");
  else                    parts.push("deal going dark");

  if      (c.score >= 80) parts.push("contract in play");
  else if (c.score >= 55) parts.push("quote sent");
  else if (c.score >= 25) parts.push("commercial conversation started");
  else                    parts.push("no commercial signals yet");

  if      (bg.score >= 70) parts.push("buying group well-covered");
  else if (bg.score >= 40) parts.push("partial stakeholder coverage");
  else                     parts.push("stakeholder risk");

  return `Reality ${score}: ${parts.join(", ")}.`;
}

// ── Main: compute score for a deal ───────────────────────────────────────────

export async function computeRealityScore(
  dealId:   string,
  tenantId: string,
): Promise<ScoreResult> {

  // 1. Deal archetype + expansion flag — Fix 8: $params
  const dealRows = await cypher<{ archetype: string; is_expansion: boolean | null }>(
    `MATCH (d:Deal {id: $dealId, tenant_id: $tenantId})
     RETURN {archetype: d.archetype, is_expansion: d.is_expansion} LIMIT 1`,
    { dealId, tenantId }
  );
  if (!dealRows.length) throw new Error(`Deal not found: ${dealId}`);
  const { archetype: rawArch, is_expansion } = dealRows[0];
  const archetype: "simple" | "complex" = rawArch === "complex" ? "complex" : "simple";
  const isExpansion = is_expansion === true;

  // 2. Company profile (Fix 1: industry + headcount, not tier)
  const compRows = await cypher<{ industry: string | null; headcount: number | null }>(
    `MATCH (d:Deal {id: $dealId, tenant_id: $tenantId})<-[:INVOLVED_IN]-(c:Company)
     RETURN {industry: c.industry, headcount: c.headcount} LIMIT 1`,
    { dealId, tenantId }
  );
  const company = compRows[0] ?? null;

  // 3. Stakeholders
  const stkhRows = await cypher<{ role: string; sentiment: number }>(
    `MATCH (p:Person)-[inf:INFLUENCES]->(d:Deal {id: $dealId, tenant_id: $tenantId})
     RETURN {role: inf.role, sentiment: inf.sentiment}`,
    { dealId, tenantId }
  );
  const stakeholders = stkhRows.map((r) => ({
    role:      r.role ?? "unknown",
    sentiment: parseFloat(String(r.sentiment ?? 0)),
  }));

  // 4. Activities via RELATED_TO — Fix 7: fetch direction field
  const actRows = await cypher<{ type: string; direction: string | null; occurred_at: string }>(
    `MATCH (a:Activity)-[:RELATED_TO]->(d:Deal {id: $dealId, tenant_id: $tenantId})
     RETURN {type: a.type, direction: a.direction, occurred_at: a.occurred_at}
     ORDER BY a.occurred_at DESC
     LIMIT 50`,
    { dealId, tenantId }
  );
  const activities = actRows.map((r) => ({
    type:       r.type        ?? "email",
    direction:  r.direction   ?? null,
    occurredAt: r.occurred_at ?? "",
  }));

  // 5. Commercial signals from Postgres (Fix 5: deal_uuid is the stable UUID)
  const sigResult = await pool.query<{ signal_type: string; occurred_at: string }>(
    `SELECT signal_type, occurred_at::text
     FROM deal_signals
     WHERE tenant_id = $1 AND deal_uuid = $2
     ORDER BY occurred_at DESC`,
    [tenantId, dealId],
  );
  const signals = sigResult.rows.map((r) => ({
    signalType: r.signal_type,
    occurredAt: r.occurred_at,
  }));

  // ── Score each pillar ──────────────────────────────────────────────────────
  const mom = scoreMomentum(activities, archetype);
  const com = scoreCommercial(signals);
  const bg  = scoreBuyingGroup(stakeholders, archetype);
  const str = scoreStructural(company, isExpansion);

  const weights = archetype === "complex"
    ? { momentum: 0.30, commercial: 0.30, buying_group: 0.25, structural: 0.15 }
    : { momentum: 0.40, commercial: 0.30, buying_group: 0.15, structural: 0.15 };

  const score = clamp(Math.round(
    mom.score * weights.momentum     +
    com.score * weights.commercial   +
    bg.score  * weights.buying_group +
    str.score * weights.structural,
  ), 0, 100);

  // ── Trend: most-recent snapshot at least 24 h old (Fix 6) ─────────────────
  // 24 h gives responsive feedback while ignoring intra-day recomputations.
  const snapRow = await pool.query<{ score: number }>(
    `SELECT score FROM deal_score_snapshots
     WHERE tenant_id = $1 AND deal_uuid = $2
       AND computed_at < now() - interval '24 hours'
     ORDER BY computed_at DESC LIMIT 1`,
    [tenantId, dealId],
  );
  const prevScore  = snapRow.rows[0]?.score ?? null;
  const trendDelta = prevScore != null ? score - prevScore : 0;
  const trend: "up" | "down" | "flat" =
    trendDelta > 2 ? "up" : trendDelta < -2 ? "down" : "flat";

  // ── Write snapshot on every computation (Fix 6) ───────────────────────────
  await pool.query(
    `INSERT INTO deal_score_snapshots (tenant_id, deal_uuid, score, pillar_scores, archetype)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      tenantId, dealId, score,
      JSON.stringify({
        momentum: mom.score, commercial: com.score,
        buying_group: bg.score, structural: str.score,
      }),
      archetype,
    ],
  );

  // ── Persist updated score on Deal node — Fix 8: $params ───────────────────
  await cypher(
    `MATCH (d:Deal {id: $dealId, tenant_id: $tenantId})
     SET d.reality_score = $score, d.updated_at = $now
     RETURN {id: d.id}`,
    { dealId, tenantId, score, now: new Date().toISOString() }
  );

  return {
    score,
    archetype,
    pillars: { momentum: mom, commercial: com, buying_group: bg, structural: str },
    weights,
    trend,
    trendDelta,
    explanation: buildExplanation(score, mom, com, bg),
    computedAt: new Date().toISOString(),
  };
}
