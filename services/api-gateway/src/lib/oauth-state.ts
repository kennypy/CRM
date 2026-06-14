/**
 * Single-use, server-bound OAuth `state` for integration connect/callback flows.
 *
 * The `state` parameter must NEVER be trusted as the tenant id: an attacker who
 * controls the callback could set state=<victim-tenant> and have their provider
 * tokens/bot credentials written under the victim's tenant (H-GW2). Instead we
 * mint a random state at connect time, bind it to the verified {tenantId,userId}
 * in Redis, and resolve the tenant from that record on callback. State is
 * consumed (deleted) on first use to prevent replay.
 */

import { randomBytes } from "crypto";
import { redis } from "./redis";

const OAUTH_STATE_TTL_S = 600;

export async function createOAuthState(tenantId: string, userId: string): Promise<string> {
  const state = randomBytes(32).toString("hex");
  await redis.set(
    `oauth:int:state:${state}`,
    JSON.stringify({ tenantId, userId }),
    "EX",
    OAUTH_STATE_TTL_S,
  );
  return state;
}

export async function consumeOAuthState(
  state: string | undefined,
): Promise<{ tenantId: string; userId: string } | null> {
  if (!state || !/^[0-9a-f]{64}$/.test(state)) return null;
  const key = `oauth:int:state:${state}`;
  const raw = await redis.get(key);
  if (!raw) return null;
  await redis.del(key); // single-use
  try {
    return JSON.parse(raw) as { tenantId: string; userId: string };
  } catch {
    return null;
  }
}
