import { NextRequest } from "next/server";
import { adminProxy } from "../../../_helpers";

type Ctx = { params: Promise<{ id: string; action: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id, action } = await ctx.params;
  return adminProxy(request, `/seat-requests/${id}/${action}`);
}
