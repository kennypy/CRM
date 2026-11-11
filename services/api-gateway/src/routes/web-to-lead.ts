/**
 * Public web-to-lead capture: POST /public/web-to-lead/:formKey
 *
 * Unauthenticated by design (embedded on customer websites). Defences:
 *   - unguessable per-form key; inactive forms 404
 *   - optional Origin/Referer allow-list per form
 *   - per-IP+form rate limit
 *   - honeypot field `website` — bots that fill it get a fake 200
 *   - strict field schema, no arbitrary properties stored
 *   - duplicate check on email (existing person → no new lead)
 *   - optional retURL redirect only to an allow-listed origin
 *
 * Accepts application/json or application/x-www-form-urlencoded (a plain
 * HTML <form> post needs no CORS preflight).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { parse as parseQs } from "node:querystring";
import { z } from "zod";
import { servicePool } from "../db";
import { internalFetch } from "../lib/internal-fetch";
import { GRAPH_CORE_URL } from "../lib/service-urls";
import { leadFactsFromContact, pickAssignee, setLeadOwner } from "../lib/lead-assignment";

const SubmissionSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName:  z.string().trim().min(1).max(100),
  email:     z.string().trim().email().max(254),
  company:   z.string().trim().max(300).optional(),
  title:     z.string().trim().max(200).optional(),
  phone:     z.string().trim().max(30).optional(),
  country:   z.string().trim().max(100).optional(),
  website:   z.string().max(500).optional(), // honeypot
  retURL:    z.string().url().max(2000).optional(),
});

export function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function originAllowed(allowed: string[], origin: string | null): boolean {
  if (!allowed.length) return true; // no allow-list configured
  if (!origin) return false;
  return allowed.some((a) => a.toLowerCase() === origin.toLowerCase());
}

function done(reply: FastifyReply, retURL: string | undefined, allowed: string[], status = 200) {
  if (retURL && allowed.length && originAllowed(allowed, originOf(retURL))) {
    return reply.redirect(retURL, 303);
  }
  return reply.status(status).send({ success: true, data: { received: true } });
}

async function findPersonByEmail(tenantId: string, email: string): Promise<boolean> {
  const res = await internalFetch(
    `${GRAPH_CORE_URL}/contacts?tenantId=${encodeURIComponent(tenantId)}&search=${encodeURIComponent(email)}&limit=20`,
    { headers: { "x-tenant-id": tenantId }, signal: AbortSignal.timeout(5000) },
  );
  if (!res.ok) return false;
  const body = (await res.json()) as { data?: { email?: string }[] };
  return (body.data ?? []).some((c) => (c.email ?? "").toLowerCase() === email.toLowerCase());
}

export async function webToLeadRoutes(server: FastifyInstance) {
  server.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 16 * 1024 },
    (_req, body, cb) => {
      try {
        const obj = parseQs(body as string);
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(obj)) flat[k] = Array.isArray(v) ? String(v[0]) : String(v ?? "");
        cb(null, flat);
      } catch (err) {
        cb(err as Error, undefined);
      }
    },
  );

  server.post<{ Params: { formKey: string } }>(
    "/web-to-lead/:formKey",
    {
      bodyLimit: 16 * 1024,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request: FastifyRequest<{ Params: { formKey: string } }>, reply) => {
      const { formKey } = request.params;
      if (!/^wtl_[A-Za-z0-9_-]{16,64}$/.test(formKey)) {
        return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
      }
      const { rows: [form] } = await servicePool.query(
        `SELECT id, tenant_id, allowed_origins, default_source, active
           FROM web_to_lead_forms WHERE form_key = $1`,
        [formKey],
      );
      if (!form || !form.active) {
        return reply.status(404).send({ success: false, error: { code: "NOT_FOUND" } });
      }
      const allowed: string[] = form.allowed_origins ?? [];
      const origin = originOf(request.headers.origin as string | undefined)
        ?? originOf(request.headers.referer as string | undefined);
      if (!originAllowed(allowed, origin)) {
        return reply.status(403).send({ success: false, error: { code: "ORIGIN_NOT_ALLOWED" } });
      }
      if (origin && allowed.length) {
        reply.header("Access-Control-Allow-Origin", origin);
        reply.header("Vary", "Origin");
      }

      const parsed = SubmissionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message },
        });
      }
      const s = parsed.data;
      if (s.website) {
        request.log.info({ formId: form.id }, "web_to_lead.honeypot");
        return done(reply, s.retURL, allowed);
      }

      const tenantId: string = form.tenant_id;
      await servicePool.query(
        `UPDATE web_to_lead_forms SET submissions = submissions + 1 WHERE id = $1`, [form.id],
      ).catch(() => undefined);

      if (await findPersonByEmail(tenantId, s.email).catch(() => false)) {
        request.log.info({ formId: form.id }, "web_to_lead.duplicate");
        return done(reply, s.retURL, allowed);
      }

      const create = await internalFetch(
        `${GRAPH_CORE_URL}/contacts?tenantId=${encodeURIComponent(tenantId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-tenant-id": tenantId },
          body: JSON.stringify({
            firstName: s.firstName, lastName: s.lastName, email: s.email,
            title: s.title, phone: s.phone, isLead: true, source: form.default_source,
            customFields: {
              ...(s.company ? { company: s.company } : {}),
              ...(s.country ? { country: s.country } : {}),
              webForm: form.id,
            },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!create.ok) {
        request.log.error({ status: create.status, formId: form.id }, "web_to_lead.create_failed");
        return reply.status(502).send({ success: false, error: { code: "UPSTREAM_ERROR" } });
      }
      const created = ((await create.json()) as { data?: Record<string, unknown> }).data;
      if (created?.id) {
        const facts = { ...leadFactsFromContact(created), companyName: s.company ?? null, country: s.country ?? null };
        const { userId } = await pickAssignee(tenantId, facts).catch(() => ({ userId: null }));
        if (userId) await setLeadOwner(tenantId, created.id as string, userId).catch(() => false);
      }
      return done(reply, s.retURL, allowed, 201);
    },
  );
}
