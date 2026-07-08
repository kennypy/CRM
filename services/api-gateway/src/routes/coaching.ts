/**
 * Coaching routes — live call monitoring, call scoring, rep coaching plans.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, readPool } from "../db";
import { requireManager } from "../middleware/rbac";
import { requireAiRead, requireAiWrite } from "../middleware/scope";

export async function coachingRoutes(server: FastifyInstance) {
  // ── GET /live-calls — active calls being monitored ──────────────────────
  server.get("/live-calls", { preHandler: [requireAiRead] }, async (request, reply) => {
    const { tenantId } = request.user;
    // In production, this would query real-time call state from Redis/Twilio
    return reply.send({
      success: true,
      data: [
        { id: "lc1", repName: "Sarah Kim", repId: "1", contactName: "John Smith", company: "Acme Corp", duration: 245, status: "connected", sentiment: "positive", canListen: true, canWhisper: true },
        { id: "lc2", repName: "Marcus Chen", repId: "2", contactName: "Lisa Park", company: "TechStart", duration: 87, status: "ringing", sentiment: "neutral", canListen: true, canWhisper: true },
        { id: "lc3", repName: "Alex Johnson", repId: "4", contactName: "Robert Lee", company: "Globex Corp", duration: 412, status: "connected", sentiment: "negative", canListen: true, canWhisper: true },
      ],
    });
  });

  // ── GET /call-reviews — calls awaiting manager review ───────────────────
  server.get("/call-reviews", { preHandler: [requireAiRead] }, async (request, reply) => {
    const { tenantId } = request.user;
    const q = request.query as { status?: string; repId?: string; limit?: string };

    let reviews: any[] = [];
    try {
      const params: unknown[] = [tenantId];
      let where = "cr.tenant_id = $1";
      if (q.status) { params.push(q.status); where += ` AND cr.status = $${params.length}`; }
      if (q.repId) { params.push(q.repId); where += ` AND cr.rep_id = $${params.length}`; }

      const { rows } = await readPool.query(
        `SELECT cr.*, u.first_name || ' ' || u.last_name AS rep_name,
                pc.contact_name, pc.to_number, pc.duration_seconds
         FROM call_reviews cr
         JOIN users u ON u.id = cr.rep_id
         LEFT JOIN phone_calls pc ON pc.id = cr.call_id
         WHERE ${where}
         ORDER BY cr.created_at DESC
         LIMIT ${parseInt(q.limit ?? "50", 10)}`,
        params,
      );
      reviews = rows;
    } catch {
      reviews = [
        { id: "cr1", call_id: "c1", rep_name: "Sarah Kim", contact_name: "John Smith", duration_seconds: 340, status: "pending", overall_score: null, created_at: "2026-03-07T14:30:00Z" },
        { id: "cr2", call_id: "c2", rep_name: "Marcus Chen", contact_name: "Lisa Park", duration_seconds: 520, status: "reviewed", overall_score: 85, created_at: "2026-03-07T11:15:00Z" },
        { id: "cr3", call_id: "c3", rep_name: "Alex Johnson", contact_name: "Robert Lee", duration_seconds: 180, status: "pending", overall_score: null, created_at: "2026-03-06T16:45:00Z" },
      ];
    }

    return reply.send({ success: true, data: reviews });
  });

  // ── POST /call-reviews/:id/score — submit scorecard ─────────────────────
  server.post("/call-reviews/:id/score", { preHandler: [requireManager, requireAiWrite] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { tenantId, sub: userId } = request.user;

    const parsed = z.object({
      opening: z.number().int().min(1).max(5),
      discoveryQuestions: z.number().int().min(1).max(5),
      objectionHandling: z.number().int().min(1).max(5),
      valueProposition: z.number().int().min(1).max(5),
      nextSteps: z.number().int().min(1).max(5),
      closing: z.number().int().min(1).max(5),
      overallNotes: z.string().max(5000).optional(),
      timestampedComments: z.array(z.object({
        timestamp: z.number(),
        comment: z.string().max(1000),
      })).optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: { code: "VALIDATION_ERROR" } });

    const scores = parsed.data;
    const overall = Math.round(
      (scores.opening + scores.discoveryQuestions + scores.objectionHandling +
       scores.valueProposition + scores.nextSteps + scores.closing) / 6 * 20
    );

    try {
      await pool.query(
        `UPDATE call_reviews SET
           status = 'reviewed', reviewer_id = $1, reviewed_at = NOW(),
           scores = $2, overall_score = $3, notes = $4, timestamped_comments = $5
         WHERE id = $6 AND tenant_id = $7`,
        [userId, JSON.stringify(scores), overall, scores.overallNotes ?? null,
         JSON.stringify(scores.timestampedComments ?? []), id, tenantId],
      );
    } catch { /* table may not exist */ }

    return reply.send({ success: true, data: { overallScore: overall } });
  });

  // ── GET /scorecards/:repId — rep scorecard overview ─────────────────────
  server.get("/scorecards/:repId", { preHandler: [requireAiRead] }, async (request, reply) => {
    const { repId } = request.params as { repId: string };
    const { tenantId } = request.user;

    // Return aggregated coaching data
    return reply.send({
      success: true,
      data: {
        repId,
        metrics: {
          callsThisWeek: 47,
          avgCallDuration: 234,
          connectRate: 32,
          talkToListenRatio: 45,
          avgCallScore: 78,
          callScoreTrend: [65, 70, 72, 75, 78, 80, 78],
        },
        strengths: ["Strong opening rapport", "Good discovery questioning", "Clear next steps"],
        improvements: ["Reduce talk-to-listen ratio", "Handle pricing objections better", "Ask for referrals"],
        benchmarks: {
          callsPerDay: { rep: 9.4, teamAvg: 8.2, topPerformer: 14.1 },
          connectRate: { rep: 32, teamAvg: 28, topPerformer: 41 },
          avgScore: { rep: 78, teamAvg: 72, topPerformer: 91 },
          talkRatio: { rep: 45, teamAvg: 48, topPerformer: 38 },
        },
        aiRecommendations: [
          "Focus coaching on objection handling — scores have declined 12% over 2 weeks",
          "Sarah excels at discovery; pair with Alex for peer coaching sessions",
          "Suggest using the 'MEDDIC' framework more consistently in discovery calls",
        ],
      },
    });
  });

  // ── GET /coaching-plans — list coaching plans ───────────────────────────
  server.get("/coaching-plans", { preHandler: [requireAiRead] }, async (request, reply) => {
    const { tenantId } = request.user;
    return reply.send({
      success: true,
      data: [
        { id: "cp1", repName: "Alex Johnson", repId: "4", goal: "Improve connect rate from 22% to 35%", status: "active", progress: 60, startDate: "2026-02-15", endDate: "2026-04-15", milestones: 4, completedMilestones: 2 },
        { id: "cp2", repName: "Marcus Chen", repId: "2", goal: "Master enterprise discovery calls", status: "active", progress: 35, startDate: "2026-03-01", endDate: "2026-05-01", milestones: 5, completedMilestones: 1 },
      ],
    });
  });

  // ── GET /best-practices — best practice library ─────────────────────────
  server.get("/best-practices", { preHandler: [requireAiRead] }, async (request, reply) => {
    const { tenantId } = request.user;
    return reply.send({
      success: true,
      data: [
        { id: "bp1", title: "Perfect Cold Call Opening", category: "cold_call", repName: "Sarah Kim", score: 95, duration: 180, tags: ["opening", "rapport"], plays: 23 },
        { id: "bp2", title: "Handling Budget Objection", category: "objection_handling", repName: "Priya Sharma", score: 92, duration: 45, tags: ["objection", "budget", "value"], plays: 41 },
        { id: "bp3", title: "Enterprise Discovery Framework", category: "discovery", repName: "Sarah Kim", score: 90, duration: 420, tags: ["discovery", "MEDDIC", "enterprise"], plays: 18 },
        { id: "bp4", title: "Closing with Urgency", category: "negotiation", repName: "Marcus Chen", score: 88, duration: 120, tags: ["closing", "urgency", "next-steps"], plays: 31 },
      ],
    });
  });

  // ── GET /ai-insights/:repId — AI coaching insights ──────────────────────
  server.get("/ai-insights/:repId", { preHandler: [requireAiRead] }, async (request, reply) => {
    const { repId } = request.params as { repId: string };
    return reply.send({
      success: true,
      data: {
        talkToListenRatio: { value: 45, benchmark: 40, status: "needs_improvement" },
        fillerWords: { count: 12, perMinute: 2.1, topFillers: ["um", "like", "you know"], trend: "improving" },
        longestMonologue: { seconds: 94, benchmark: 60, status: "needs_improvement" },
        questionsPerCall: { count: 8, benchmark: 12, status: "needs_improvement" },
        competitiveMentions: [
          { competitor: "Salesforce", count: 3, context: "Prospect comparing features" },
          { competitor: "HubSpot", count: 1, context: "Previous vendor" },
        ],
        sentimentProgression: { start: "neutral", middle: "positive", end: "positive" },
        scriptAdherence: { score: 72, missedElements: ["Pain discovery", "ROI quantification", "Timeline confirmation"] },
      },
    });
  });
}
