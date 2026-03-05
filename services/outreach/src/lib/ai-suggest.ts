/**
 * AI-powered email suggestion engine.
 *
 * Provider support:
 *  - "anthropic"     — Anthropic Claude API (default, uses ANTHROPIC_API_KEY or tenant key)
 *  - "openai_compat" — Any OpenAI-compatible endpoint (OpenAI, Ollama, LM Studio, etc.)
 *                      Configured via tenant.settings.ai_outreach.base_url
 *
 * Per-tenant configuration stored in tenants.settings.ai_outreach:
 *  { provider, model, api_key_enc, base_url }
 * Falls back to system ANTHROPIC_API_KEY if no tenant key configured.
 */

import Anthropic from "@anthropic-ai/sdk";
import { decrypt } from "./encrypt";

export interface AIProviderConfig {
  provider: "anthropic" | "openai_compat";
  model:    string;
  apiKey?:  string; // decrypted; undefined = use env var
  baseUrl?: string; // for openai_compat
}

export interface SuggestEmailArgs {
  step:         number;
  sequenceName: string;
  contact: {
    firstName:   string;
    lastName:    string;
    title?:      string;
    company?:    string;
    email:       string;
  };
  dealContext?: {
    name:  string;
    stage: string;
    value?: number;
  };
  recentActivities?: string[]; // summaries of last 5 activities
  existingSubject?:  string;   // if rep has typed something, include it
  existingBody?:     string;
  providerConfig?:   AIProviderConfig;
}

export interface EmailSuggestion {
  subject: string;
  body:    string;
}

const SYSTEM_PROMPT = `You are an expert B2B sales email writer embedded in a CRM.
Generate concise, personalized outreach emails that:
- Are professional but human, not robotic
- Reference specific context (deal stage, company, recent activity)
- Have a clear, single call to action
- Avoid spam trigger words
- Follow CAN-SPAM best practices
Always respond with valid JSON: { "subject": "...", "body": "..." }
The body should be plain text, 2-4 short paragraphs maximum.`;

/**
 * Generate an email subject and body suggestion using the configured AI provider.
 * Returns a suggestion or null on failure (caller shows fallback).
 */
export async function suggestEmail(args: SuggestEmailArgs): Promise<EmailSuggestion | null> {
  const cfg = args.providerConfig;

  const context = buildContext(args);
  const userPrompt = `Write step ${args.step} of a sequence called "${args.sequenceName}".

Contact: ${args.contact.firstName} ${args.contact.lastName}${args.contact.title ? `, ${args.contact.title}` : ""}${args.contact.company ? ` at ${args.contact.company}` : ""}
${args.dealContext ? `Deal: ${args.dealContext.name} (${args.dealContext.stage}${args.dealContext.value ? `, $${args.dealContext.value.toLocaleString()}` : ""})` : ""}
${args.recentActivities?.length ? `\nRecent activity context:\n${args.recentActivities.slice(0, 5).map(a => `- ${a}`).join("\n")}` : ""}
${args.existingSubject ? `\nRep's draft subject: ${args.existingSubject}` : ""}
${args.existingBody ? `\nRep's draft body:\n${args.existingBody}` : ""}

Generate a sales email. Respond ONLY with JSON: { "subject": "...", "body": "..." }`;

  try {
    if (!cfg || cfg.provider === "anthropic") {
      return await suggestWithAnthropic(userPrompt, cfg?.apiKey, cfg?.model);
    } else {
      return await suggestWithOpenAICompat(userPrompt, cfg);
    }
  } catch (err) {
    console.error("AI suggestion failed:", (err as Error).message);
    return null;
  }
}

async function suggestWithAnthropic(
  userPrompt: string,
  apiKey?:    string,
  model?:     string,
): Promise<EmailSuggestion | null> {
  const client = new Anthropic({
    apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
  });

  const response = await client.messages.create({
    model:      model ?? process.env.AI_MODEL ?? "claude-sonnet-4-6",
    max_tokens: 1024,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: "user", content: userPrompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  return parseEmailJSON(text);
}

async function suggestWithOpenAICompat(
  userPrompt: string,
  cfg: AIProviderConfig,
): Promise<EmailSuggestion | null> {
  const baseUrl = cfg.baseUrl ?? "https://api.openai.com/v1";
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.model ?? "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userPrompt },
      ],
      max_tokens: 1024,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI-compat request failed: ${res.status}`);
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "";
  return parseEmailJSON(text);
}

function parseEmailJSON(text: string): EmailSuggestion | null {
  try {
    // Strip markdown code fences if present
    const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(clean) as { subject?: string; body?: string };
    if (!parsed.subject || !parsed.body) return null;
    return { subject: parsed.subject, body: parsed.body };
  } catch {
    return null;
  }
}

function buildContext(_args: SuggestEmailArgs): string {
  return ""; // reserved for future RAG context injection
}

/**
 * Resolve and decrypt per-tenant AI provider config from tenants.settings.
 */
export function resolveProviderConfig(
  tenantSettings: Record<string, unknown> | null,
): AIProviderConfig | undefined {
  const raw = (tenantSettings as any)?.ai_outreach as Record<string, unknown> | undefined;
  if (!raw) return undefined;

  const provider = (raw.provider as string) === "openai_compat" ? "openai_compat" : "anthropic";
  let apiKey: string | undefined;

  if (raw.api_key_enc && typeof raw.api_key_enc === "string") {
    try {
      apiKey = decrypt(raw.api_key_enc);
    } catch {
      // Decryption failed — fall back to system key
    }
  }

  return {
    provider,
    model:   (raw.model as string) ?? undefined,
    apiKey,
    baseUrl: (raw.base_url as string) ?? undefined,
  };
}
