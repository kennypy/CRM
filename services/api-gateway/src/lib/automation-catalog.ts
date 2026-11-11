/**
 * Automation catalog — the single contract between every NexCRM module that
 * produces events and everything that consumes them (workflow engine,
 * outbound webhooks, workflow builder UI, timeline).
 *
 * Before this existed, producers, the engine and the UI each had their own
 * names: the UI saved {label} with no type, the engine matched `deal.updated`
 * for stage changes that were emitted as `deal.stage_changed`, and 11 of the
 * 20 UI actions had no handler (silently reported as success). Everything now
 * derives from these lists; GET /api/v1/automation/catalog serves them.
 */

export type EntityType =
  | "contact" | "company" | "deal" | "activity" | "task" | "quote"
  | "approval_request" | "enrollment" | "booking" | "user" | "phone_call";

export interface EventDef {
  type: string;
  entityType: EntityType;
  label: string;
  /** Payload keys consumers can rely on (for conditions / webhook docs). */
  payload: string[];
  /** Offered as a workflow trigger. */
  trigger: boolean;
}

export const EVENT_CATALOG: EventDef[] = [
  // Contacts / leads
  { type: "contact.created",   entityType: "contact", label: "Contact created", payload: ["isLead", "source", "ownerId", "email"], trigger: true },
  { type: "contact.updated",   entityType: "contact", label: "Contact updated", payload: ["changes"], trigger: true },
  { type: "contact.deleted",   entityType: "contact", label: "Contact deleted", payload: [], trigger: false },
  { type: "contact.merged",    entityType: "contact", label: "Contacts merged", payload: ["mergedIds"], trigger: true },
  { type: "lead.created",      entityType: "contact", label: "Lead created", payload: ["source", "ownerId", "email", "webFormId"], trigger: true },
  { type: "lead.assigned",     entityType: "contact", label: "Lead assigned", payload: ["ownerId", "ruleId"], trigger: true },
  { type: "lead.converted",    entityType: "contact", label: "Lead converted", payload: ["conversionId", "companyId", "dealId"], trigger: true },
  { type: "contact.opted_out", entityType: "contact", label: "Contact opted out", payload: ["channel", "reason", "email"], trigger: true },
  // Accounts
  { type: "company.created",   entityType: "company", label: "Account created", payload: [], trigger: true },
  { type: "company.updated",   entityType: "company", label: "Account updated", payload: ["changes"], trigger: true },
  { type: "company.deleted",   entityType: "company", label: "Account deleted", payload: [], trigger: false },
  // Opportunities
  { type: "deal.created",      entityType: "deal", label: "Opportunity created", payload: ["stage", "value", "ownerId"], trigger: true },
  { type: "deal.updated",      entityType: "deal", label: "Opportunity updated", payload: ["changes"], trigger: true },
  { type: "deal.stage_changed",entityType: "deal", label: "Opportunity stage changed", payload: ["stage", "previousStage"], trigger: true },
  { type: "deal.closed_won",   entityType: "deal", label: "Opportunity won", payload: ["stage", "value"], trigger: true },
  { type: "deal.closed_lost",  entityType: "deal", label: "Opportunity lost", payload: ["stage", "value"], trigger: true },
  { type: "deal.deleted",      entityType: "deal", label: "Opportunity deleted", payload: [], trigger: false },
  { type: "reality_score.updated", entityType: "deal", label: "Reality score updated", payload: ["score"], trigger: false },
  // Activities & tasks
  { type: "activity.created",  entityType: "activity", label: "Activity logged", payload: ["type"], trigger: true },
  { type: "activity.updated",  entityType: "activity", label: "Activity updated", payload: [], trigger: false },
  { type: "activity.deleted",  entityType: "activity", label: "Activity deleted", payload: [], trigger: false },
  { type: "task.created",      entityType: "task", label: "Task created", payload: ["assigneeId", "relatedToType", "relatedToId"], trigger: true },
  { type: "task.completed",    entityType: "task", label: "Task completed", payload: ["assigneeId", "relatedToType", "relatedToId"], trigger: true },
  { type: "meeting.booked",    entityType: "booking", label: "Meeting booked", payload: [], trigger: true },
  { type: "call.logged",       entityType: "phone_call", label: "Call logged", payload: ["direction", "provider", "contactEmail"], trigger: true },
  // Quotes & approvals
  { type: "quote.created",     entityType: "quote", label: "Quote created", payload: ["dealId", "total", "approvalRequired"], trigger: true },
  { type: "quote.updated",     entityType: "quote", label: "Quote updated", payload: ["dealId", "total", "approvalRequired"], trigger: false },
  { type: "quote.sent",        entityType: "quote", label: "Quote sent", payload: ["dealId", "total"], trigger: true },
  { type: "quote.accepted",    entityType: "quote", label: "Quote accepted", payload: ["dealId", "total"], trigger: true },
  { type: "quote.rejected",    entityType: "quote", label: "Quote rejected by customer", payload: ["dealId", "total"], trigger: true },
  { type: "quote.synced",      entityType: "quote", label: "Quote synced to opportunity", payload: ["dealId", "value"], trigger: false },
  { type: "approval.submitted",entityType: "approval_request", label: "Approval submitted", payload: ["quoteId", "dealId", "discountPct"], trigger: true },
  { type: "approval.approved", entityType: "approval_request", label: "Approval granted", payload: ["quoteId", "dealId"], trigger: true },
  { type: "approval.rejected", entityType: "approval_request", label: "Approval rejected", payload: ["quoteId", "dealId", "reason"], trigger: true },
  { type: "approval.recalled", entityType: "approval_request", label: "Approval recalled", payload: ["quoteId", "dealId"], trigger: false },
  // Engagement
  { type: "sequence.enrolled", entityType: "enrollment", label: "Enrolled in sequence", payload: ["sequenceId", "contactEmail"], trigger: false },
  { type: "sequence.enrollment.completed", entityType: "enrollment", label: "Sequence completed", payload: ["sequenceId"], trigger: true },
  // Users
  { type: "user.deactivated",  entityType: "user", label: "User deactivated", payload: ["transferredTo"], trigger: false },
  { type: "user.reactivated",  entityType: "user", label: "User reactivated", payload: [], trigger: false },
];

export const EVENT_TYPES = EVENT_CATALOG.map((e) => e.type);
export const EVENT_BY_TYPE = new Map(EVENT_CATALOG.map((e) => [e.type, e]));

/** Producers that pre-date the catalog use graph labels as entity types. */
export function canonicalEntityType(t: string): string {
  return t === "person" || t === "lead" ? "contact" : t;
}

// ── Workflow triggers ─────────────────────────────────────────────────────────

export interface TriggerDef {
  type: string;
  label: string;
  entityType: EntityType;
  /** Extra trigger options the builder must render. */
  options?: { key: string; label: string; kind: "stage" | "number" | "direction" }[];
}

export const TRIGGER_CATALOG: TriggerDef[] = [
  ...EVENT_CATALOG.filter((e) => e.trigger).map((e): TriggerDef => ({
    type: e.type, label: e.label, entityType: e.entityType,
    ...(e.type === "deal.stage_changed" ? { options: [{ key: "toStage", label: "To stage (optional)", kind: "stage" as const }] } : {}),
  })),
  {
    type: "score.threshold", label: "Reality score crosses threshold", entityType: "deal",
    options: [
      { key: "threshold", label: "Threshold", kind: "number" },
      { key: "direction", label: "Direction", kind: "direction" },
    ],
  },
];

// ── Workflow actions ──────────────────────────────────────────────────────────

export type FieldKind = "string" | "text" | "number" | "url" | "stage" | "priority"
  | "user" | "team" | "sequence" | "recipient" | "assignMode" | "emailTo" | "channels";

export interface ActionField { key: string; label: string; kind: FieldKind; required?: boolean }
export interface ActionDef {
  type: string;
  label: string;
  /** Entity types the action applies to; others are skipped (not failed). */
  appliesTo: EntityType[] | "any";
  fields: ActionField[];
}

const RECORDS: EntityType[] = ["contact", "company", "deal"];

export const ACTION_CATALOG: ActionDef[] = [
  { type: "create_task", label: "Create task", appliesTo: "any", fields: [
    { key: "title", label: "Title", kind: "string", required: true },
    { key: "dueInDays", label: "Due in (days)", kind: "number" },
    { key: "priority", label: "Priority", kind: "priority" },
    { key: "assignTo", label: "Assign to", kind: "recipient" },
    { key: "userId", label: "User (when assigning to a specific user)", kind: "user" },
  ] },
  { type: "send_email", label: "Send email", appliesTo: ["contact", "deal", "company", "quote"], fields: [
    { key: "to", label: "To", kind: "emailTo", required: true },
    { key: "address", label: "Address (when To = address)", kind: "string" },
    { key: "subject", label: "Subject", kind: "string", required: true },
    { key: "body", label: "Body", kind: "text", required: true },
  ] },
  { type: "notify", label: "Notify user", appliesTo: "any", fields: [
    { key: "recipient", label: "Recipient", kind: "recipient", required: true },
    { key: "userId", label: "User (when recipient = user)", kind: "user" },
    { key: "message", label: "Message", kind: "text", required: true },
    { key: "channels", label: "Channels", kind: "channels" },
  ] },
  { type: "update_field", label: "Update field", appliesTo: RECORDS, fields: [
    { key: "field", label: "Field", kind: "string", required: true },
    { key: "value", label: "Value", kind: "string", required: true },
  ] },
  { type: "update_stage", label: "Move opportunity stage", appliesTo: ["deal"], fields: [
    { key: "stage", label: "Stage", kind: "stage", required: true },
  ] },
  { type: "assign_owner", label: "Assign owner", appliesTo: RECORDS, fields: [
    { key: "mode", label: "Mode", kind: "assignMode", required: true },
    { key: "userId", label: "User", kind: "user" },
    { key: "teamId", label: "Team (round robin)", kind: "team" },
  ] },
  { type: "add_tag", label: "Add tag", appliesTo: RECORDS, fields: [
    { key: "tag", label: "Tag", kind: "string", required: true },
  ] },
  { type: "add_to_sequence", label: "Enroll in sequence", appliesTo: ["contact"], fields: [
    { key: "sequenceId", label: "Sequence", kind: "sequence", required: true },
  ] },
  { type: "pause_sequences", label: "Pause active sequences", appliesTo: ["contact"], fields: [] },
  { type: "send_webhook", label: "Call webhook", appliesTo: "any", fields: [
    { key: "url", label: "URL", kind: "url", required: true },
  ] },
  { type: "ai_score_lead", label: "Re-score lead (AI)", appliesTo: ["contact"], fields: [] },
];

export const ACTION_BY_TYPE = new Map(ACTION_CATALOG.map((a) => [a.type, a]));

/** Legacy / UI-menu names → canonical action + config defaults. */
export const ACTION_ALIASES: Record<string, { type: string; defaults?: Record<string, unknown> }> = {
  fire_webhook:   { type: "send_webhook" },
  seq_enrol:      { type: "add_to_sequence" },
  add_email_seq:  { type: "add_to_sequence" },
  seq_pause:      { type: "pause_sequences" },
  seq_remove:     { type: "pause_sequences" },
  assign_rep:     { type: "assign_owner", defaults: { mode: "user" } },
  notify_owner:   { type: "notify", defaults: { recipient: "owner", channels: "in_app" } },
  notify_manager: { type: "notify", defaults: { recipient: "manager", channels: "in_app" } },
  slack_message:  { type: "notify", defaults: { recipient: "owner", channels: "slack" } },
  ai_score:       { type: "ai_score_lead" },
  schedule_call:  { type: "create_task", defaults: { title: "Call", assignTo: "owner", dueInDays: 1 } },
  add_call_list:  { type: "create_task", defaults: { title: "Call", assignTo: "owner" } },
  schedule_email: { type: "send_email" },
};

export function resolveAction(type: string): { type: string; defaults: Record<string, unknown> } | null {
  if (ACTION_BY_TYPE.has(type)) return { type, defaults: {} };
  const a = ACTION_ALIASES[type];
  return a ? { type: a.type, defaults: a.defaults ?? {} } : null;
}

export const MAX_ACTION_DELAY_MINUTES = 60 * 24 * 30;
