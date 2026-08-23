import { NextRequest, NextResponse } from "next/server";

import { AUTH_SERVICE_URL } from "../../../api/_env";

/**
 * Public SCIM 2.0 proxy — identity providers point their provisioning
 * integration at ${APP_URL}/scim/v2 and every request is forwarded to the
 * auth service, which authenticates the per-tenant bearer token and serves
 * the SCIM resources. The proxy passes the body and Authorization header
 * through untouched; auth is enforced upstream.
 */
async function proxy(request: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const url = new URL(`${AUTH_SERVICE_URL}/scim/v2/${path.map(encodeURIComponent).join("/")}`);
  request.nextUrl.searchParams.forEach((v, k) => url.searchParams.append(k, v));

  const headers: Record<string, string> = {};
  const auth = request.headers.get("authorization");
  if (auth) headers.Authorization = auth;
  const contentType = request.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;

  const hasBody = request.method !== "GET" && request.method !== "DELETE" && request.method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : undefined,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: "503", detail: "SCIM service unreachable" },
      { status: 503 },
    );
  }

  const body = await upstream.arrayBuffer();
  return new NextResponse(body.byteLength ? body : null, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/scim+json",
      ...(upstream.headers.get("www-authenticate")
        ? { "WWW-Authenticate": upstream.headers.get("www-authenticate") as string }
        : {}),
    },
  });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, ctx: Ctx)    { return proxy(request, ctx.params); }
export async function POST(request: NextRequest, ctx: Ctx)   { return proxy(request, ctx.params); }
export async function PUT(request: NextRequest, ctx: Ctx)    { return proxy(request, ctx.params); }
export async function PATCH(request: NextRequest, ctx: Ctx)  { return proxy(request, ctx.params); }
export async function DELETE(request: NextRequest, ctx: Ctx) { return proxy(request, ctx.params); }
