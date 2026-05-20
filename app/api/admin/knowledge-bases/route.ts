import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

// 5.19up 知识库方案 A · PR-A3 · 知识库列表 + 新建
// 权限（D2）：仅 super_admin / system_admin 可建管知识库；org_admin 无权（防租户资料串库）

/** D2：org_admin 不可访问知识库 */
function denyKbAdmin(role: string): boolean {
  return role !== "super_admin" && role !== "system_admin";
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (denyKbAdmin(admin.role)) return apiError("无权访问知识库", "FORBIDDEN");

  // 可选 ?status=active|disabled —— 不传则返全量（兼容现有调用）
  // 方案 B 的搭建器可用 ?status=active 只列出可绑定的库
  const statusParam = req.nextUrl.searchParams.get("status");
  let query = db
    .from("knowledge_bases")
    .select("*")
    .order("created_at", { ascending: false });
  if (statusParam === "active" || statusParam === "disabled") {
    query = query.eq("status", statusParam);
  }
  const { data, error } = await query;
  if (error) {
    console.error("[knowledge-bases list]", error);
    return apiError("获取知识库列表失败", "INTERNAL_ERROR");
  }

  const kbs = (data ?? []) as { id: string }[];
  // 附每个库的文档数
  const counts: Record<string, number> = {};
  const ids = kbs.map((k) => k.id);
  if (ids.length > 0) {
    const { data: docs, error: docErr } = await db
      .from("kb_documents")
      .select("kb_id")
      .in("kb_id", ids);
    if (docErr) {
      console.error("[knowledge-bases list] 文档计数失败", docErr);
    } else {
      for (const d of (docs ?? []) as { kb_id: string }[]) {
        counts[d.kb_id] = (counts[d.kb_id] ?? 0) + 1;
      }
    }
  }

  return NextResponse.json({
    data: kbs.map((k) => ({ ...k, document_count: counts[k.id] ?? 0 })),
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (denyKbAdmin(admin.role)) return apiError("无权创建知识库", "FORBIDDEN");

  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const description = String(body.description ?? "").trim();
  if (!name) return apiError("知识库名称不能为空", "VALIDATION_ERROR");
  if (name.length > 100) return apiError("知识库名称过长（上限 100 字）", "VALIDATION_ERROR");

  // 小B minor：建库时记录当前 embedding 模型名，便于将来识别"哪些库需按新模型重建"
  // 查询失败不阻塞（字段留空，建库照常成功）
  let embedding_model = "";
  try {
    const { data: emb } = await db
      .from("model_providers")
      .select("default_model")
      .eq("category", "embedding")
      .eq("enabled", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    embedding_model = (emb?.default_model ?? "").trim();
  } catch (e) {
    console.error("[knowledge-bases create] 读取 embedding 模型名失败（不阻塞）", e);
  }

  const { data, error } = await db
    .from("knowledge_bases")
    .insert({ name, description, embedding_model, created_by: admin.adminId })
    .select("*")
    .single();
  if (error) {
    console.error("[knowledge-bases create]", error);
    return apiError("创建知识库失败", "INTERNAL_ERROR");
  }

  return NextResponse.json({ ...data, document_count: 0 });
}
