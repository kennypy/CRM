import { NextRequest } from "next/server";

import { authSessionProxy } from "../_proxy";

// Consumes an email verification token; the auth service returns working
// tokens on success, which the shared proxy sets as HttpOnly cookies —
// the user lands straight in the app.
export async function POST(request: NextRequest) {
  return authSessionProxy(request, "/auth/verify-email");
}
