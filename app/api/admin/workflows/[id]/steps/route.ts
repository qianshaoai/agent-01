import { NextRequest, NextResponse } from "next/server";
import { getActiveAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getActiveAdmin())) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { id: workflowId } = await params;
  const { stepOrder, title, description, execType, agentId, buttonText, enabled } = await req.json();

  if (!title) return NextResponse.json({ error: "请填写步骤标题" }, { status: 400 });

  const validExecTypes = ["agent", "manual", "review", "external"];
  const safeExecType = validExecTypes.includes(execType) ? execType : "agent";

  const { data, error } = await db
    .from("workflow_steps")
    .insert({
      workflow_id: workflowId,
      step_order: stepOrder ?? 1,
      title,
      description: description ?? "",
      exec_type: safeExecType,
      agent_id: safeExecType === "agent" ? (agentId || null) : null,
      button_text: buttonText ?? "进入智能体",
      enabled: enabled ?? true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
