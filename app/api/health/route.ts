import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();

  let dbStatus: "ok" | "error" = "ok";
  let dbErr: string | undefined;
  try {
    const { error } = await db.from("admins").select("id", { count: "exact", head: true });
    if (error) { dbStatus = "error"; dbErr = "query failed"; }
  } catch {
    dbStatus = "error";
    dbErr = "connection failed";
  }

  const healthy = dbStatus === "ok";

  return NextResponse.json(
    {
      status: healthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        database: { status: dbStatus, ...(dbErr ? { error: dbErr } : {}) },
      },
      responseTime: Date.now() - start,
    },
    { status: healthy ? 200 : 503 }
  );
}
