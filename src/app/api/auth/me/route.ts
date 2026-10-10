import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { route } from "@/server/http";

export const GET = route(async (request) => {
  const user = await requireUser(prisma, request);
  return NextResponse.json({ user: { email: user.email, callsign: user.callsign, role: user.role } });
});
