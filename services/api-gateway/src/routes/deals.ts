import type { FastifyInstance } from "fastify";
import { createProxy } from "../lib/proxy";

const GRAPH_CORE  = process.env.GRAPH_CORE_URL  ?? "http://localhost:4002";
const AI_ENGINE   = process.env.AI_ENGINE_URL   ?? "http://localhost:5001";

export async function dealsRoutes(server: FastifyInstance) {
  const graphProxy = createProxy({ baseUrl: GRAPH_CORE, stripPrefix: "/api/v1" });
  const aiProxy    = createProxy({ baseUrl: AI_ENGINE });

  server.get("/",       graphProxy);
  server.post("/",      graphProxy);
  server.get("/:id",    graphProxy);
  server.patch("/:id",  graphProxy);
  server.delete("/:id", graphProxy);
  server.get("/:id/timeline", graphProxy);

  // Reality Score comes from the AI Engine
  server.get("/:id/reality-score", async (request, reply) => {
    const { id } = request.params as { id: string };
    const jwt = (request as any).user as { tenantId: string };
    const resp = await fetch(
      `${AI_ENGINE}/scoring/reality-score`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: id, tenant_id: jwt.tenantId }),
      }
    ).catch(() => null);

    if (!resp?.ok) {
      return reply.status(503).send({ success: false, error: { code: "AI_UNAVAILABLE" } });
    }
    return reply.send({ success: true, data: await resp.json() });
  });
}
