import { NextResponse } from "next/server";
import { buildClearCookieHeader } from "@/lib/auth";

export async function POST() {
  return NextResponse.json(
    { ok: true },
    { headers: { "Set-Cookie": buildClearCookieHeader() } }
  );
}
