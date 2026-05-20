import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

// 5.19up 知识库方案 A · PR-A3 · 知识库详情 / 更新 / 删除
// 权限（D2）：仅 super_admin / system_admin

function denyKbAdmin(role: string): boolean {
  return role !== "super_admin" && role !== "system_admin";
}

/** GET：知识库详情 + 文档列表 + 「被哪些智能体引用」反查 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (denyKbAdmin(admin.role)) return apiError("无权访问知识库", "FORBIDDEN");

  const { id } = await params;
  const { data: kb, error } = await db
    .from("knowledge_bases")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[knowledge-bases get]", error);
    return apiError("获取知识库详情失败", "INTERNAL_ERROR");
  }
  if (!kb) return apiError("知识库不存在", "NOT_FOUND");

  const { data: documents, error: docErr } = await db
    .from("kb_documents")
    .select("id, kb_id, filename, file_type, status, chunk_count, char_count, error_msg, created_at")
    .eq("kb_id", id)
    .order("created_at", { ascending: false });
  if (docErr) {
    console.error("[knowledge-bases get] 文档列表失败", docErr);
    return apiError("获取文档列表失败", "INTERNAL_ERROR");
  }

  // 反查：被哪些智能体引用
  const { data: links, error: linkErr } = await db
    .from("agent_knowledge_bases")
    .select("agent_id")
    .eq("kb_id", id);
  if (linkErr) {
    console.error("[knowledge-bases get] 引用反查失败", linkErr);
    return apiError("引用反查失败", "INTERNAL_ERROR");
  }
  let referencedByAgents: { id: string; name: string }[] = [];
  const agentIds = (links ?? []).map((l: { agent_id: string }) => l.agent_id);
  if (agentIds.length > 0) {
    const { data: agents } = await db
      .from("agents")
      .select("id, name")
      .in("id", agentIds);
    referencedByAgents = (agents ?? []) as { id: string; name: string }[];
  }

  return NextResponse.json({
    knowledgeBase: kb,
    documents: documents ?? [],
    referencedByAgents,
  });
}

/** PATCH：改名 / 改描述 / 启停 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (denyKbAdmin(admin.role)) return apiError("无权修改知识库", "FORBIDDEN");

  const { id } = await params;
  const body = await req.json();
  const patch: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return apiError("知识库名称不能为空", "VALIDATION_ERROR");
    if (name.length > 100) return apiError("知识库名称过长（上限 100 字）", "VALIDATION_ERROR");
    patch.name = name;
  }
  if (typeof body.description === "string") {
    patch.description = body.description.trim();
  }
  if (typeof body.status === "string") {
    if (body.status !== "active" && body.status !== "disabled") {
      return apiError("状态只能是 active / disabled", "VALIDATION_ERROR");
    }
    patch.status = body.status;
  }
  if (Object.keys(patch).length === 0) {
    return apiError("没有可更新的字段", "VALIDATION_ERROR");
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await db
    .from("knowledge_bases")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    console.error("[knowledge-bases update]", error);
    return apiError("更新知识库失败", "INTERNAL_ERROR");
  }

  return NextResponse.json(data);
}

/** DELETE：删除知识库。被智能体引用时阻止（避免静默解绑）。文档 / 切片由 FK 级联删除。 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (denyKbAdmin(admin.role)) return apiError("无权删除知识库", "FORBIDDEN");

  const { id } = await params;

  // 引用检查：被智能体绑定时禁止删除
  const { count: refCount, error: refErr } = await db
    .from("agent_knowledge_bases")
    .select("agent_id", { count: "exact", head: true })
    .eq("kb_id", id);
  if (refErr) {
    console.error("[knowledge-bases delete] 引用检查失败", refErr);
    return apiError("引用检查失败，请重试", "INTERNAL_ERROR");
  }
  if (refCount && refCount > 0) {
    return apiError(
      `该知识库被 ${refCount} 个智能体引用，请先在搭建器解除绑定`,
      "VALIDATION_ERROR",
    );
  }

  const { data: kb } = await db
    .from("knowledge_bases")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  if (!kb) return apiError("知识库不存在", "NOT_FOUND");

  // 删除存储里的文档文件（DB 行由 FK 级联删除）
  const { data: docs } = await db
    .from("kb_documents")
    .select("storage_path")
    .eq("kb_id", id);
  const paths = ((docs ?? []) as { storage_path: string }[])
    .map((d) => d.storage_path)
    .filter(Boolean);
  if (paths.length > 0) {
    const { error: rmErr } = await db.storage.from("uploads").remove(paths);
    if (rmErr) console.error("[knowledge-bases delete] 清理存储文件失败（不阻断）", rmErr);
  }

  const { error } = await db.from("knowledge_bases").delete().eq("id", id);
  if (error) {
    console.error("[knowledge-bases delete]", error);
    return apiError("删除知识库失败", "INTERNAL_ERROR");
  }

  return NextResponse.json({ ok: true });
}
