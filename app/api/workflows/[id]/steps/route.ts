import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, requireFullUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const guard = requireFullUser(user);
  if (guard) return guard;

  const { id } = await params;

  const { data: workflow, error } = await db
    .from("workflows")
    .select(`
      id, name, description,
      workflow_steps (
        id, step_order, title, description, exec_type, agent_id, button_text, enabled,
        agents:agent_id ( id, agent_code, name, agent_type, external_url )
      )
    `)
    .eq("id", id)
    .eq("enabled", true)
    .single();

  if (error || !workflow) {
    return NextResponse.json({ error: "工作流不存在" }, { status: 404 });
  }

  type StepRow = {
    id: string; step_order: number; title: string; description: string;
    exec_type: string; agent_id: string | null; button_text: string; enabled: boolean;
    agents: { id: string; agent_code: string; name: string; agent_type: string; external_url: string } | null;
  };
  const raw = (workflow.workflow_steps ?? []) as unknown as StepRow[];
  const steps = raw
    .filter((s) => s.enabled)
    .sort((a, b) => a.step_order - b.step_order);

  return NextResponse.json({ id: workflow.id, name: workflow.name, description: workflow.description, steps });
}
