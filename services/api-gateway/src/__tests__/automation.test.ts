import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ACTION_ALIASES, ACTION_CATALOG, EVENT_CATALOG, EVENT_TYPES, TRIGGER_CATALOG, resolveAction,
} from "../lib/automation-catalog";
import { DefinitionSchema, checkDefinition } from "../lib/workflow-definition";
import {
  MAX_WORKFLOW_DEPTH, buildContext, evaluateConditions, eventDepth, matchesTrigger, mergeTemplate,
  nextRoundRobinIndex, targetRecord, type CrmEvent,
} from "../lib/workflow-runtime";
import { IMPLEMENTED_ACTIONS } from "../workers/workflow-actions";
import { urlValidationResponse, vttToText } from "../lib/zoom";

const ROOT = join(__dirname, "../../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f === "__tests__" || f === "__pycache__") continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|py)$/.test(f) && !/(seed|sample-data)\.ts$/.test(f)) out.push(p);
  }
  return out;
}

const ev = (over: Partial<CrmEvent>): CrmEvent => ({
  id: "e1", tenant_id: "t", event_type: "deal.stage_changed", entity_type: "deal", entity_id: "d1", payload: {}, ...over,
});

describe("automation contract (cross-module)", () => {
  it("every event type a service publishes is in the catalog", () => {
    const allowedInternal = /^(crm_writer\.|signal\.|reality_score\.error|entity\.created|score\.threshold|lead\.lifecycle_changed)/;
    const offenders: string[] = [];
    for (const dir of ["services/api-gateway/src", "services/graph-core/src", "services/outreach/src"]) {
      for (const file of walk(join(ROOT, dir))) {
        const src = readFileSync(file, "utf8");
        // INSERT INTO crm_events ... VALUES ($1, '<type>' ...) and emitEvent(tenant, "<type>" ...)
        const patterns = [
          /INSERT INTO (?:public\.)?crm_events[\s\S]{0,200}?VALUES \(\$1,\s*'([a-z_.]+)'/g,
          /emitEvent\(\s*[\w.]+,\s*"([a-z_.]+)"/g,
          /emitTaskEvent\(\s*\w+,\s*"([a-z_.]+)"/g,
        ];
        for (const re of patterns) {
          for (const m of src.matchAll(re)) {
            if (!EVENT_TYPES.includes(m[1]) && !allowedInternal.test(m[1])) offenders.push(`${file.replace(ROOT, "")}: ${m[1]}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every catalog action has a handler and every alias resolves", () => {
    for (const a of ACTION_CATALOG) expect(IMPLEMENTED_ACTIONS).toContain(a.type);
    for (const alias of Object.keys(ACTION_ALIASES)) expect(IMPLEMENTED_ACTIONS).toContain(resolveAction(alias)!.type);
    expect(resolveAction("ai_summarise")).toBeNull(); // not offered: no backend exists
  });

  it("triggers are a subset of events plus score.threshold", () => {
    for (const t of TRIGGER_CATALOG) {
      expect(t.type === "score.threshold" || EVENT_CATALOG.some((e) => e.type === t.type)).toBe(true);
    }
  });
});

describe("workflow definitions", () => {
  it("accepts a structured definition and applies defaults", () => {
    const d = DefinitionSchema.parse({
      trigger: { type: "deal.stage_changed", toStage: "closed_won" },
      actions: [{ type: "create_task", config: { title: "Kickoff" } }, { type: "notify_manager", config: { message: "Won!" } }],
    });
    expect(d.actions[0].delayMinutes).toBe(0);
    expect(d.conditions).toEqual([]);
  });
  it("rejects the legacy UI shape (label-only trigger/actions) with a reason", () => {
    const r = checkDefinition({ trigger: { label: "Deal stage changes", category: "deal" }, conditions: [], actions: [{ label: "Send email" }] });
    expect(r.ok).toBe(false);
  });
  it("rejects unknown actions and missing required config", () => {
    expect(DefinitionSchema.safeParse({ trigger: { type: "deal.created" }, actions: [{ type: "ai_summarise" }] }).success).toBe(false);
    expect(DefinitionSchema.safeParse({ trigger: { type: "deal.created" }, actions: [{ type: "send_email", config: { to: "record" } }] }).success).toBe(false);
    expect(DefinitionSchema.safeParse({ trigger: { type: "score.threshold" }, actions: [{ type: "notify", config: { recipient: "owner", message: "x" } }] }).success).toBe(false);
  });
});

describe("workflow runtime", () => {
  it("stage trigger matches every real transition including closes", () => {
    const t = { type: "deal.stage_changed" } as const;
    expect(matchesTrigger(t, ev({}))).toBe(true);
    expect(matchesTrigger(t, ev({ event_type: "deal.closed_won", payload: { stage: "closed_won" } }))).toBe(true);
    expect(matchesTrigger(t, ev({ event_type: "deal.updated" }))).toBe(false); // the old (never-firing) mapping
    expect(matchesTrigger({ type: "deal.stage_changed", toStage: "closed_won" }, ev({ event_type: "deal.closed_won", payload: { stage: "closed_won" } }))).toBe(true);
    expect(matchesTrigger({ type: "deal.stage_changed", toStage: "proposal" }, ev({ payload: { stage: "discovery" } }))).toBe(false);
  });
  it("score threshold", () => {
    const e = ev({ event_type: "reality_score.updated", payload: { score: 30 } });
    expect(matchesTrigger({ type: "score.threshold", threshold: 40, direction: "below" }, e)).toBe(true);
    expect(matchesTrigger({ type: "score.threshold", threshold: 40, direction: "above" }, e)).toBe(false);
  });
  it("conditions over record + payload; unknown operators never match", () => {
    const ctx = buildContext(ev({ payload: { stage: "proposal" } }), { value: 75000, stage: "discovery", source: "Web" });
    expect(evaluateConditions([{ field: "stage", operator: "equals", value: "proposal" }], ctx)).toBe(true);
    expect(evaluateConditions([{ field: "value", operator: "gte", value: 50000 }, { field: "source", operator: "in", value: ["web", "event"] }], ctx)).toBe(true);
    expect(evaluateConditions([{ field: "missing", operator: "gt", value: 0 }], ctx)).toBe(false);
    expect(evaluateConditions([{ field: "stage", operator: "bogus" as never, value: "x" }], ctx)).toBe(false);
  });
  it("loop protection depth", () => {
    expect(eventDepth(ev({ payload: { _origin: "workflow:2" } }))).toBe(2);
    expect(eventDepth(ev({ payload: { _origin: "evil" } }))).toBe(0);
    expect(MAX_WORKFLOW_DEPTH).toBeGreaterThanOrEqual(1);
  });
  it("targets related records across modules", () => {
    const quoteAccepted = ev({ event_type: "quote.accepted", entity_type: "quote", entity_id: "q1", payload: { dealId: "d9" } });
    expect(targetRecord("deal", quoteAccepted)).toBe("d9");
    expect(targetRecord("contact", ev({ entity_type: "person", entity_id: "c1" }))).toBe("c1");
    expect(targetRecord("contact", ev({ entity_type: "task", payload: { relatedToType: "contact", relatedToId: "c2" } }))).toBe("c2");
  });
  it("template merge + round robin", () => {
    expect(mergeTemplate("Hi {{firstName}}, re {{company.name}}{{missing}}", { firstName: "Ann", company: { name: "Acme" } })).toBe("Hi Ann, re Acme");
    expect([1, 2, 3, 4].map((n) => nextRoundRobinIndex(n, 3))).toEqual([0, 1, 2, 0]);
  });
});

describe("zoom helpers", () => {
  it("answers the URL validation challenge", () => {
    const r = urlValidationResponse("abc", "secret");
    expect(r.plainToken).toBe("abc");
    expect(r.encryptedToken).toMatch(/^[0-9a-f]{64}$/);
  });
  it("converts WebVTT to text", () => {
    expect(vttToText("WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nAnn: Hello\n\n2\n00:00:03.000 --> 00:00:04.000\nBob: Hi")).toBe("Ann: Hello\nBob: Hi");
  });
});
