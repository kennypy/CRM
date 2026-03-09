/**
 * Centralized service URL configuration.
 * All inter-service URLs are defined here to avoid scattered localhost fallbacks.
 */

export const GRAPH_CORE_URL = process.env.GRAPH_CORE_URL ?? "http://localhost:4002";
export const OUTREACH_URL = process.env.OUTREACH_URL ?? "http://localhost:4003";
export const AI_ENGINE_URL = process.env.AI_ENGINE_URL ?? "http://localhost:5001";
