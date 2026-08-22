/**
 * Shared report-builder schema: sources, fields, join suggestions, filter
 * operators. Used by both the reports list page and the report builder
 * (previously each carried its own drifting copy).
 */

export type SourceId = "activities" | "deals" | "companies" | "contacts" | "quotes" | "users";
export type JoinType  = "LEFT" | "INNER";

export const SOURCE_LABELS: Record<SourceId, string> = {
  activities: "Activities",
  deals:      "Opportunities",
  companies:  "Companies",
  contacts:   "Contacts",
  quotes:     "Quotes",
  users:      "Users",
};

export const SOURCE_FIELDS: Record<SourceId, { key: string; label: string }[]> = {
  activities: [
    { key: "id",               label: "Activity ID" },
    { key: "type",             label: "Type" },
    { key: "direction",        label: "Direction" },
    { key: "subject",          label: "Subject" },
    { key: "summary",          label: "Summary" },
    { key: "sentiment",        label: "Sentiment" },
    { key: "duration_seconds", label: "Duration seconds" },
    { key: "occurred_at",      label: "Created date" },
    { key: "deal_id",          label: "Deal ID" },
    { key: "company_id",       label: "Company ID" },
    { key: "source",           label: "Source" },
    { key: "created_at",       label: "Created date" },
    { key: "created_by",       label: "Created By" },
    { key: "related_to",       label: "Related To" },
  ],
  deals: [
    { key: "id",                        label: "Deal ID" },
    { key: "name",                      label: "Name" },
    { key: "stage",                     label: "Stage" },
    { key: "value",                     label: "Value" },
    { key: "currency",                  label: "Currency" },
    { key: "close_date",                label: "Close Date" },
    { key: "company_id",                label: "Company ID" },
    { key: "owner_id",                  label: "Owner ID" },
    { key: "reality_score",             label: "Reality Score" },
    { key: "created_at",                label: "Created date" },
    { key: "updated_at",                label: "Last update date" },
    { key: "created_by",                label: "Created by" },
    { key: "line_item",                 label: "Line Item" },
    { key: "value_usd",                 label: "Value ($)" },
    { key: "value_eur",                 label: "Value (\u20ac) Converted" },
    { key: "main_poc",                  label: "Main POC" },
    { key: "last_opportunity_activity", label: "Last opportunity Activity" },
  ],
  companies: [
    { key: "id",                    label: "Company ID" },
    { key: "name",                  label: "Name" },
    { key: "domain",                label: "Domain" },
    { key: "city",                  label: "City" },
    { key: "country",               label: "Country" },
    { key: "sub_region",            label: "Sub Region" },
    { key: "region",                label: "Region" },
    { key: "created_at",            label: "Created Date" },
    { key: "updated_at",            label: "Last update date" },
    { key: "created_by",            label: "Created by" },
    { key: "opportunities_name",    label: "Opportunity Name" },
    { key: "last_company_activity", label: "Last Company Activity" },
    { key: "linked_url",            label: "LinkedIn URL" },
    { key: "industry",              label: "Industry" },
    { key: "sub_industry",          label: "Sub Industry" },
    { key: "revenue",               label: "Revenue ($)" },
    { key: "employees",             label: "Employees" },
    { key: "segment",               label: "Segment" },
  ],
  contacts: [
    { key: "id",            label: "Contact ID" },
    { key: "firstName",     label: "First Name" },
    { key: "lastName",      label: "Last Name" },
    { key: "fullName",      label: "Full Name" },
    { key: "email",         label: "email" },
    { key: "title",         label: "Title" },
    { key: "seniority",     label: "Seniority" },
    { key: "isLead",        label: "Previous Lead" },
    { key: "created_at",    label: "Created date" },
    { key: "updated_at",    label: "Last update date" },
    { key: "created_by",    label: "Created by" },
    { key: "last_activity", label: "Last Contact Activity" },
  ],
  quotes: [
    { key: "id",           label: "Quote ID" },
    { key: "quote_number", label: "Quote Number" },
    { key: "title",        label: "Title" },
    { key: "status",       label: "Status" },
    { key: "company_name", label: "Company Name" },
    { key: "contact_name", label: "Contact Name" },
    { key: "total",        label: "Total" },
    { key: "subtotal",     label: "Subtotal" },
    { key: "currency",     label: "Currency" },
    { key: "valid_until",  label: "Valid Until" },
    { key: "created_at",   label: "Created At" },
    { key: "updated_at",   label: "Updated At" },
    { key: "created_by",   label: "Created By" },
    { key: "related_to",   label: "Related To" },
  ],
  users: [
    { key: "id",            label: "User ID" },
    { key: "first_name",    label: "First Name" },
    { key: "last_name",     label: "Last Name" },
    { key: "email",         label: "email" },
    { key: "role",          label: "Role" },
    { key: "can_quote",     label: "Can Quote" },
    { key: "country",       label: "Country" },
    { key: "timezone",      label: "Timezone" },
    { key: "language",      label: "language" },
    { key: "phone",         label: "Phone" },
    { key: "twilio_number", label: "Twilio Number" },
  ],
};

// Common join suggestions (auto-populated when sources selected)
export const JOIN_SUGGESTIONS: Array<{ from: SourceId; to: SourceId; label: string; on: { left: string; right: string } }> = [
  { from: "activities", to: "deals",     label: "Activity → Deal",    on: { left: "deal_id",    right: "id" } },
  { from: "activities", to: "companies", label: "Activity → Company", on: { left: "company_id", right: "id" } },
  { from: "deals",      to: "companies", label: "Deal → Company",     on: { left: "company_id", right: "id" } },
  { from: "quotes",     to: "contacts",  label: "Quote → Contact",    on: { left: "contact_id", right: "id" } },
  { from: "quotes",     to: "deals",     label: "Quote → Deal",       on: { left: "deal_id",    right: "id" } },
  { from: "contacts",   to: "companies", label: "Contact → Company",  on: { left: "company_id", right: "id" } },
];

export const PERIOD_OPTIONS = [
  { value: "",              label: "All time" },
  { value: "last_24_hours", label: "Last 24 hours" },
  { value: "last_7_days",   label: "Last 7 days" },
  { value: "last_30_days",  label: "Last 30 days" },
  { value: "last_90_days",  label: "Last 90 days" },
  { value: "last_year",     label: "Last year" },
  { value: "custom",        label: "Custom…" },
];

export const FILTER_OPS = [
  { value: "eq",           label: "equals" },
  { value: "neq",          label: "not equals" },
  { value: "contains",     label: "contains" },
  { value: "not_contains", label: "not contains" },
  { value: "gt",           label: "greater than" },
  { value: "gte",          label: "≥" },
  { value: "lt",           label: "less than" },
  { value: "lte",          label: "≤" },
  { value: "is_null",      label: "is empty" },
  { value: "not_null",     label: "is not empty" },
  { value: "in",           label: "in (comma-sep)" },
];

export interface JoinDef {
  id:   string;
  type: JoinType;
  from: SourceId;
  to:   SourceId;
  on:   { left: string; right: string };
}

export interface FilterRow {
  id:     string;
  source: SourceId;
  field:  string;
  op:     string;
  value:  string;
}

export interface QueryResult {
  rows:     Record<string, unknown>[];
  columns:  string[];
  rowCount: number;
}
