import { NextRequest } from "next/server";
import { adminProxy } from "../_helpers";

export async function POST(request: NextRequest) {
  return adminProxy(request, "/merges");
}
