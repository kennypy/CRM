/**
 * Upstream service URLs for Route Handlers. Previously each route re-declared
 * these env fallbacks (16 copies across api/ and graphql/).
 */

export const API_GATEWAY_URL = process.env.API_GATEWAY_URL ?? "http://localhost:4000";
export const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";
