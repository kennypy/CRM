import { NextRequest } from "next/server";
import { adminProxy } from "../../../_helpers";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return adminProxy(request, `/merges/${id}/cancel`, "POST");
}
