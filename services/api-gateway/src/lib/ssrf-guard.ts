/**
 * SSRF egress guard.
 *
 * Validates a user-/tenant-supplied URL before the server makes an outbound
 * request to it. Blocks requests to loopback, private (RFC1918), link-local,
 * unique-local, and cloud-metadata addresses, and rejects non-http(s) schemes.
 *
 * DNS is resolved and EVERY returned address is checked, which also defeats
 * DNS-rebinding (a hostname that resolves to a public address on first lookup
 * but a private one later) for the request we are about to make: callers should
 * pass the IP returned here to the actual fetch, or re-validate immediately
 * before connecting. We additionally pin the resolved host via the `lookup`
 * option so fetch connects to the address we vetted.
 *
 * Set `<PREFIX>_ALLOW_PRIVATE_HOST=true` to permit private targets for
 * intentional self-hosted/dev setups (e.g. a local Ollama endpoint).
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) | o;
  }
  return n >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable → treat as unsafe
  const inRange = (cidr: number, bits: number) => (n & (~0 << (32 - bits))) >>> 0 === cidr;
  return (
    inRange(ipv4ToInt("0.0.0.0")!, 8) ||        // 0.0.0.0/8 "this network"
    inRange(ipv4ToInt("10.0.0.0")!, 8) ||       // private
    inRange(ipv4ToInt("100.64.0.0")!, 10) ||    // CGNAT
    inRange(ipv4ToInt("127.0.0.0")!, 8) ||      // loopback
    inRange(ipv4ToInt("169.254.0.0")!, 16) ||   // link-local + cloud metadata (169.254.169.254)
    inRange(ipv4ToInt("172.16.0.0")!, 12) ||    // private
    inRange(ipv4ToInt("192.0.0.0")!, 24) ||     // IETF protocol assignments
    inRange(ipv4ToInt("192.168.0.0")!, 16) ||   // private
    inRange(ipv4ToInt("198.18.0.0")!, 15) ||    // benchmarking
    inRange(ipv4ToInt("224.0.0.0")!, 4) ||      // multicast
    inRange(ipv4ToInt("240.0.0.0")!, 4)         // reserved
  );
}

function isPrivateIPv6(ip: string): boolean {
  const a = ip.toLowerCase().split("%")[0]; // strip zone id
  if (a === "::1" || a === "::") return true;           // loopback / unspecified
  if (a.startsWith("fe80") || a.startsWith("fe9") ||
      a.startsWith("fea") || a.startsWith("feb")) return true; // link-local fe80::/10
  if (a.startsWith("fc") || a.startsWith("fd")) return true;   // unique-local fc00::/7
  if (a.startsWith("ff")) return true;                          // multicast
  // IPv4-mapped (::ffff:a.b.c.d) — extract and check as v4
  const m = a.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return isPrivateIPv4(m[1]);
  return false;
}

function isBlockedIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return isPrivateIPv4(ip);
  if (fam === 6) return isPrivateIPv6(ip);
  return true; // not an IP we understand → block
}

export interface SsrfGuardOptions {
  /** Allowed URL schemes. Default: https only. */
  protocols?: string[];
  /** Env var that, when "true", permits private/loopback targets. */
  allowPrivateEnvVar?: string;
}

/**
 * Validate `rawUrl` for SSRF safety. Throws `SsrfBlockedError` if unsafe.
 * Returns the parsed URL and the vetted resolved IP (pass as fetch `lookup`).
 */
export async function assertSafeUrl(
  rawUrl: string,
  opts: SsrfGuardOptions = {},
): Promise<{ url: URL; address: string; family: number }> {
  const protocols = opts.protocols ?? ["https:"];
  const allowPrivate =
    !!opts.allowPrivateEnvVar && process.env[opts.allowPrivateEnvVar] === "true";

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError("Invalid URL");
  }

  if (!protocols.includes(url.protocol)) {
    throw new SsrfBlockedError(`Blocked URL scheme: ${url.protocol}`);
  }

  // Reject credentials in the URL (avoids leaking auth / SSRF tricks).
  if (url.username || url.password) {
    throw new SsrfBlockedError("Credentials in URL are not allowed");
  }

  const host = url.hostname.replace(/^\[|\]$/g, ""); // unwrap [::1]

  // Literal IP host — check directly.
  if (isIP(host)) {
    if (!allowPrivate && isBlockedIp(host)) {
      throw new SsrfBlockedError(`Blocked host address: ${host}`);
    }
    return { url, address: host, family: isIP(host) };
  }

  // Hostname — resolve every address and reject if ANY is private.
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new SsrfBlockedError(`Host did not resolve: ${host}`);
  }
  if (addrs.length === 0) throw new SsrfBlockedError(`Host did not resolve: ${host}`);

  for (const a of addrs) {
    if (!allowPrivate && isBlockedIp(a.address)) {
      throw new SsrfBlockedError(`Host ${host} resolves to a blocked address`);
    }
  }
  // Pin to the first vetted address so fetch connects to what we validated.
  return { url, address: addrs[0].address, family: addrs[0].family };
}
