import { describe, expect, it } from "vitest";
import {
  actionSummaries, actionsForTrigger, buildWorkflowBody, categoryFor, conditionFieldSuggestions,
  draftFromRow, emptyAction, emptyDraft, groupEventsByEntity, triggerLabel, validateDraft,
  type AutomationCatalog, type WorkflowDraft, type WorkflowRow,
} from "@/lib/automation";

const catalog: AutomationCatalog = {
  events: [
    { type: "deal.stage_changed", entityType: "deal", label: "Opportunity stage changed", payload: ["stage", "previousStage"], trigger: true },
    { type: "lead.created", entityType: "contact", label: "Lead created", payload: ["source"], trigger: true },
    { type: "quote.sent", entityType: "quote", label: "Quote sent", payload: ["dealId"], trigger: true },
  ],
  triggers: [
    { type: "deal.stage_changed", label: "Opportunity stage changed", entityType: "deal",
      options: [{ key: "toStage", label: "To stage", kind: "stage" }] },
    { type: "lead.created", label: "Lead created", entityType: "contact" },
    { type: "score.threshold", label: "Reality score crosses threshold", entityType: "deal",
      options: [{ key: "threshold", label: "Threshold", kind: "number" }, { key: "direction", label: "Direction", kind: "direction" }] },
  ],
  actions: [
    { type: "create_task", label: "Create task", appliesTo: "any", fields: [
      { key: "title", label: "Title", kind: "string", required: true },
      { key: "dueInDays", label: "Due in (days)", kind: "number" },
      { key: "assignTo", label: "Assign to", kind: "recipient" },
    ] },
    { type: "update_stage", label: "Move opportunity stage", appliesTo: ["deal"], fields: [
      { key: "stage", label: "Stage", kind: "stage", required: true },
    ] },
    { type: "add_to_sequence", label: "Enroll in sequence", appliesTo: ["contact"], fields: [
      { key: "sequenceId", label: "Sequence", kind: "sequence", required: true },
    ] },
  ],
  actionAliases: ["seq_enrol"],
  conditionOperators: ["equals", "gt", "in", "is_blank"],
};

describe("buildWorkflowBody", () => {
  it("produces the structured contract the engine executes", () => {
    const d: WorkflowDraft = {
      ...emptyDraft(catalog),
      name: "  Won → onboarding ",
      triggerType: "deal.stage_changed",
      triggerOptions: { toStage: "closed_won" },
      conditions: [
        { field: "value", operator: "gt", value: "50000" },
        { field: "source", operator: "in", value: "web, event" },
        { field: "email", operator: "is_blank", value: "ignored" },
        { field: "  ", operator: "equals", value: "dropped" },
      ],
      actions: [
        { type: "create_task", config: { title: "Kickoff", dueInDays: "3", assignTo: "" }, delayMinutes: "60" },
        { type: "", config: {}, delayMinutes: "" },
      ],
    };
    expect(buildWorkflowBody(d, catalog)).toEqual({
      name: "Won → onboarding",
      is_active: true,
      trigger: { type: "deal.stage_changed", label: "Opportunity stage changed", category: "deal", toStage: "closed_won" },
      conditions: [
        { field: "value", operator: "gt", value: 50000 },
        { field: "source", operator: "in", value: ["web", "event"] },
        { field: "email", operator: "is_blank" },
      ],
      actions: [{ type: "create_task", config: { title: "Kickoff", dueInDays: 3 }, delayMinutes: 60 }],
    });
  });

  it("maps threshold trigger options to numbers and clamps delays", () => {
    const body = buildWorkflowBody({
      ...emptyDraft(catalog), name: "x", triggerType: "score.threshold",
      triggerOptions: { threshold: "40", direction: "below" },
      actions: [{ type: "create_task", config: { title: "t" }, delayMinutes: "999999999" }],
    }, catalog);
    expect(body.trigger).toMatchObject({ type: "score.threshold", threshold: 40, direction: "below" });
    expect(body.actions[0].delayMinutes).toBe(60 * 24 * 30);
  });
});

describe("draftFromRow", () => {
  it("round-trips a structured row", () => {
    const row: WorkflowRow = {
      id: "w1", name: "A", description: null, is_active: true,
      trigger: { type: "deal.stage_changed", toStage: "proposal" },
      conditions: [{ field: "value", operator: "gte", value: 10 }],
      actions: [{ type: "update_stage", config: { stage: "negotiation" }, delayMinutes: 5 }],
    };
    const d = draftFromRow(row, catalog);
    expect(d).toMatchObject({
      id: "w1", triggerType: "deal.stage_changed", triggerOptions: { toStage: "proposal" },
      conditions: [{ field: "value", operator: "gte", value: "10" }],
      actions: [{ type: "update_stage", config: { stage: "negotiation" }, delayMinutes: "5" }],
    });
    expect(buildWorkflowBody(d, catalog).actions[0]).toEqual({ type: "update_stage", config: { stage: "negotiation" }, delayMinutes: 5 });
  });

  it("recovers what it can from legacy label-only rows and keeps them inactive", () => {
    const row: WorkflowRow = {
      id: "w2", name: "Legacy", description: "", is_active: true, needsSetup: true, setupReason: "Unknown trigger type",
      trigger: { label: "Deal moved to Closed Won", category: "deal" },
      conditions: [],
      actions: [{ label: "create_task||Legal review" }, { label: "ai_summarise" }],
    };
    const d = draftFromRow(row, catalog);
    expect(d.isActive).toBe(false);
    expect(d.triggerType).toBe("deal.stage_changed"); // first catalog trigger as a starting point
    expect(d.actions[0]).toEqual({ type: "create_task", config: { title: "Legal review" }, delayMinutes: "" });
    expect(d.actions[1].type).toBe("ai_summarise");
    expect(validateDraft(d, catalog)).toContain("action:ai_summarise");
  });
});

describe("validation + display helpers", () => {
  it("flags missing required fields and threshold", () => {
    const d = { ...emptyDraft(catalog), name: "", triggerType: "score.threshold",
      actions: [{ type: "update_stage", config: {}, delayMinutes: "" }] };
    expect(validateDraft(d, catalog)).toEqual(["name", "threshold", "update_stage.stage"]);
  });

  it("pre-fills required enum fields on new actions", () => {
    expect(emptyAction(catalog.actions[1]).config).toEqual({ stage: "lead" });
  });

  it("filters actions to the trigger's entity", () => {
    expect(actionsForTrigger(catalog, "lead.created").map((a) => a.type)).toEqual(["create_task", "add_to_sequence"]);
    expect(actionsForTrigger(catalog, "deal.stage_changed").map((a) => a.type)).toEqual(["create_task", "update_stage"]);
  });

  it("labels and summaries", () => {
    const row: WorkflowRow = {
      id: "w", name: "n", description: null, is_active: true,
      trigger: { type: "deal.stage_changed", toStage: "closed_won" }, conditions: [],
      actions: [{ type: "create_task", config: { title: "Kickoff" }, delayMinutes: 30 }, { label: "seq_enrol||Nurture" }],
    };
    expect(triggerLabel(row, catalog)).toBe("Opportunity stage changed → closed_won");
    expect(actionSummaries(row, catalog)).toEqual(["Create task: Kickoff (+30m)", "seq_enrol"]);
    expect(categoryFor("approval_request")).toBe("quote");
    expect(categoryFor("company")).toBe("contact");
    expect(conditionFieldSuggestions(catalog, "deal.stage_changed").slice(0, 3)).toEqual(["stage", "previousStage", "value"]);
    expect(groupEventsByEntity(catalog.events).map(([k]) => k)).toEqual(["deal", "contact", "quote"]);
  });
});
