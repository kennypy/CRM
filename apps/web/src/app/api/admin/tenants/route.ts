import { NextRequest } from "next/server";
import { adminProxy } from "../_helpers";

export async function GET(request: NextRequest) {
  return adminProxy(request, "/tenants");
}

export async function POST(request: NextRequest) {
  return adminProxy(request, "/tenants");
}
