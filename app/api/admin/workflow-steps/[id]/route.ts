import { dbError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { getActiveAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getActiveAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const updates: Record<string, unknown> = {};

  if (body.stepOrder !== undefined) updates.step_order = body.stepOrder;
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  const validExecTypes = ["agent", "manual", "review", "external"];
  if (body.execType !== undefined) updates.exec_type = validExecTypes.includes(body.execType) ? body.execType : "agent";
  if (body.agentId !== undefined) updates.agent_id = updates.exec_type === "agent" ? (body.agentId || null) : null;
  if (body.buttonText !== undefined) updates.button_text = body.buttonText;
  if (body.enabled !== undefined) updates.enabled = body.enabled;

  const { data, error } = await db
    .from("workflow_steps")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return dbError(error);
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getActiveAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id } = await params;
  const { error } = await db.from("workflow_steps").delete().eq("id", id);
  if (error) return dbError(error);
  return NextResponse.json({ ok: true });
}
