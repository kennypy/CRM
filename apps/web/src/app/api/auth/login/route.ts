import { NextRequest } from "next/server";

import { authSessionProxy } from "../_proxy";

export async function POST(request: NextRequest) {
  return authSessionProxy(request, "/auth/login");
}
