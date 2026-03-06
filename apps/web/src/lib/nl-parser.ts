/**
 * Natural-language parser for the Action Bar.
 * Pattern-matching only — no API calls.
 *
 * Extracts:
 *   intent:     log_activity | create_quote | send_quote | build_sequence | open_report | unknown
 *   company:    string (company name if found)
 *   contact:    string
 *   activityType: email | call | meeting | note
 *   products:   Array<{ name, quantity, discountPct }>
 *   sentiment:  positive | negative | neutral
 *   period:     string (date range if mentioned)
 *   filter:     object (for reports)
 */

export type NLIntent =
  | "log_activity"
  | "create_quote"
  | "send_quote"
  | "build_sequence"
  | "open_report"
  | "unknown";

export type ActivityType = "email" | "call" | "meeting" | "note";

export interface ParsedProduct {
  name:        string;
  quantity:    number;
  discountPct: number;
}

export interface ParseResult {
  intent:       NLIntent;
  company?:     string;
  contact?:     string;
  activityType?: ActivityType;
  products:     ParsedProduct[];
  sentiment?:   "positive" | "negative" | "neutral";
  period?:      string;
  filter?:      Record<string, string>;
  raw:          string;
  confidence:   number; // 0–1
}

// ── Intent detection patterns ─────────────────────────────────────────────────

const LOG_PATTERNS = [
  /\b(had|just had|just finished|took|completed|logged?)\b.*(call|meeting|email|chat|conversation)\b/i,
  /\b(spoke|talked|met|emailed|called|chatted)\b.*(with|to)\b/i,
  /\b(i (sent|wrote|drafted))\b/i,
  /\bnote[:\s]/i,
  /\bjust spoke\b/i,
];

const QUOTE_CREATE_PATTERNS = [
  /\b(create|build|make|draft|prepare|generate)\b.*(quote|proposal|pricing|offer)\b/i,
  /\b(quote|proposal)\b.*\bfor\b/i,
  /\bsend.*(pricing|quote)\b.*\bfor\b/i,
  /\b\d+\s*(x\s*)?(licenses?|seats?|users?)\b/i,
];

const QUOTE_SEND_PATTERNS = [
  /\bsend\b.*(quote|proposal)\b/i,
  /\bemail.*(latest|approved|current)\b.*(quote|proposal)\b/i,
  /\bforward.*(quote|proposal)\b/i,
];

const SEQUENCE_PATTERNS = [
  /\b(build|create|start|launch)\b.*(campaign|sequence|outreach|cadence)\b/i,
  /\b(email\s*campaign|drip\s*(campaign|sequence))\b/i,
  /\bcampaign\b.*\bfor\b.*\b(director|manager|vp|c-suite|cto|ceo|cfo|head of)\b/i,
];

const REPORT_PATTERNS = [
  /\b(show|view|open|run|pull\s+up)\b.*(report|pipeline|dashboard|analytics)\b/i,
  /\bwhat.*(activities|deals|opportunities|pipeline|revenue)\b/i,
  /\bhow\s*(many|much)\b/i,
];

// ── Activity type detection ───────────────────────────────────────────────────
function detectActivityType(text: string): ActivityType | undefined {
  const t = text.toLowerCase();
  if (/\bcall(ed)?\b/.test(t) || /\bphone\b/.test(t))              return "call";
  if (/\bmeeting\b|\bmet\b|\bspoke\b|\bchat(ted)?\b|\bconference\b/.test(t)) return "meeting";
  if (/\bemail(ed)?\b|\bsent\s+a\s+message\b|\bwrote\b/.test(t))  return "email";
  if (/\bnote\b|\bjotted\b/.test(t))                                return "note";
  return undefined;
}

// ── Sentiment detection ───────────────────────────────────────────────────────
function detectSentiment(text: string): "positive" | "negative" | "neutral" {
  const t = text.toLowerCase();
  const positive = /\b(want|wants|interested|keen|excited|ready|love|like|positive|keen|buy|purchase|upgrade|proceed|close|commit|sign)\b/.test(t);
  const negative = /\b(not interested|declined|rejected|no budget|postponed|stall|lost|cancel|pull out|walk away|dead)\b/.test(t);
  if (positive) return "positive";
  if (negative) return "negative";
  return "neutral";
}

// ── Company name extraction ───────────────────────────────────────────────────
function extractCompany(text: string): string | undefined {
  // "with ACME Corp", "for Acme", "at TechStart", "to Globex", "from Initech"
  const match =
    text.match(/\b(?:with|for|at|to|from|called|meeting with|spoke (?:to|with)|email(?:ed)? (?:to|from)?)\s+([A-Z][A-Za-z0-9&\s'.-]{1,40}?)(?:\s*,|\s+(?:about|re:|regarding|they|and|who|the|for\b)|$)/m) ??
    text.match(/^([A-Z][A-Za-z0-9&\s'.-]{1,40}?)\s+(?:want|wants|is|are|said|told|asked)\b/m);
  if (match) {
    const raw = match[1].trim().replace(/\s+/g, " ");
    // Filter out common false positives
    if (!/^(I|Me|He|She|They|We|It|The|A|An|My|Our|Their|Your|This|That|These|Those)$/i.test(raw)) {
      return raw;
    }
  }
  return undefined;
}

// ── Product / line-item extraction ────────────────────────────────────────────
// Handles: "3 licenses", "5 x Pro licenses", "3 Enterprise seats at 10% discount"
// "3 licenses of X", "5 X licenses with 10%", "3 x Pro with 0% discount"
function extractProducts(text: string): ParsedProduct[] {
  const results: ParsedProduct[] = [];
  const t = text;

  // Pattern: "[qty] [x] [product name] [with [a] [discount]% [discount]]"
  // e.g. "3 x Pro licenses with 10% discount", "5 CRM-PRO-M with a 10% discount"
  // Greedy hyphen-aware product name; optional article "a/an" before percentage
  // Product name stops before connector words (with/at/for/in/of) so the discount suffix can match.
  const re = /\b(\d+(?:\.\d+)?)\s*(?:x\s+)?([A-Za-z][A-Za-z0-9-]*(?:\s+(?!(?:with|at|for|in|of)\b)[A-Za-z0-9-]+){0,6})(?:\s+(?:licenses?|seats?|users?|copies?|units?))?(?:\s+(?:with|at)\s+(?:an?\s+)?(\d+(?:\.\d+)?)%(?:\s+(?:discount|off))?)?/gi;

  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const qty         = parseFloat(m[1]);
    let   productName = m[2].trim().replace(/\s+/g, " ");
    const discountPct = m[3] ? parseFloat(m[3]) : 0;

    // Skip if name is clearly not a product (common words)
    if (/^(a|an|the|some|any|my|your|their|our|its|this|that|me|him|her|them|us|you|they|i|we|call|email|meeting|note|activity|quote|proposal)$/i.test(productName)) continue;
    if (qty < 1 || qty > 10000) continue;

    results.push({ name: productName, quantity: qty, discountPct });
  }

  return results;
}

// ── Period detection (for activity log / report context) ─────────────────────
function detectPeriod(text: string): string | undefined {
  const t = text.toLowerCase();
  if (/\byesterday\b/.test(t))                    return "Yesterday";
  if (/\btoday\b/.test(t))                        return "Today";
  if (/\bthis\s+week\b/.test(t))                  return "This week";
  if (/\blast\s+week\b/.test(t))                   return "Last week";
  if (/\bthis\s+month\b/.test(t))                 return "This month";
  if (/\blast\s+month\b/.test(t))                  return "Last month";
  if (/\blast\s+7\s+days?\b/.test(t))             return "Last 7 days";
  if (/\blast\s+30\s+days?\b/.test(t))            return "Last 30 days";
  if (/\blast\s+90\s+days?|quarter/.test(t))      return "Last 90 days";
  if (/\bthis\s+quarter\b/.test(t))               return "This quarter";
  if (/\bnext\s+week\b/.test(t))                  return "Next week";
  if (/\bnext\s+month\b/.test(t))                 return "Next month";
  if (/\bnext\s+quarter\b/.test(t))               return "Next quarter";
  if (/\bclosing\s+this\s+week\b/.test(t))        return "Closing this week";
  if (/\bclosing\s+this\s+month\b/.test(t))       return "Closing this month";
  if (/\b(q1)\b/.test(t))                         return "Q1";
  if (/\b(q2)\b/.test(t))                         return "Q2";
  if (/\b(q3)\b/.test(t))                         return "Q3";
  if (/\b(q4)\b/.test(t))                         return "Q4";
  return undefined;
}

// ── Main parse function ───────────────────────────────────────────────────────
export function parseNL(text: string): ParseResult {
  const result: ParseResult = {
    intent:   "unknown",
    products: [],
    raw:      text,
    confidence: 0,
  };

  const isLog      = LOG_PATTERNS.some((p)      => p.test(text));
  const isQuoteSend = QUOTE_SEND_PATTERNS.some((p) => p.test(text));
  const isQuote    = !isQuoteSend && QUOTE_CREATE_PATTERNS.some((p) => p.test(text));
  const isSequence = SEQUENCE_PATTERNS.some((p)  => p.test(text));
  const isReport   = REPORT_PATTERNS.some((p)    => p.test(text));

  // Priority: quote-send > create quote > log activity > sequence > report
  if (isQuoteSend) {
    result.intent     = "send_quote";
    result.confidence = 0.85;
  } else if (isQuote) {
    result.intent     = "create_quote";
    result.confidence = 0.85;
    result.products   = extractProducts(text);
  } else if (isLog) {
    result.intent       = "log_activity";
    result.confidence   = 0.9;
    result.activityType = detectActivityType(text);
    result.sentiment    = detectSentiment(text);
    // If log mentions products/quantities, surface a quote prompt
    result.products     = extractProducts(text);
  } else if (isSequence) {
    result.intent     = "build_sequence";
    result.confidence = 0.8;
  } else if (isReport) {
    result.intent     = "open_report";
    result.confidence = 0.75;
  }

  result.company = extractCompany(text);
  result.period  = detectPeriod(text);

  return result;
}

// ── Human-readable summary ───────────────────────────────────────────────────
export function summariseIntent(r: ParseResult): string {
  switch (r.intent) {
    case "log_activity":
      return [
        r.activityType ? `Log ${r.activityType}` : "Log activity",
        r.company      ? `with ${r.company}`      : "",
        r.sentiment === "positive" ? " — positive sentiment detected" : "",
        r.products.length ? ` — ${r.products.length} product mention(s) found` : "",
      ].filter(Boolean).join(" ");

    case "create_quote":
      return [
        "Create quote",
        r.company     ? `for ${r.company}` : "",
        r.products.length ? `(${r.products.map((p) => `${p.quantity}× ${p.name}${p.discountPct > 0 ? ` @${p.discountPct}% off` : ""}`).join(", ")})` : "",
      ].filter(Boolean).join(" ");

    case "send_quote":
      return r.company ? `Send latest approved quote to ${r.company}` : "Send quote";

    case "build_sequence":
      return r.company ? `Build sequence targeting ${r.company}` : "Build sequence / campaign";

    case "open_report":
      return r.period ? `Open report — ${r.period}` : "Open report";

    default:
      return "What would you like to do?";
  }
}
