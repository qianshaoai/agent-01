import { apiError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import {
  listScopeFilter,
  resolveCreateOwnership,
  requireWriteAccess,
  validateTenantCode,
  ScopeAdminNoTenantError,
} from "@/lib/scoped-access";

// 5.19up 知识库方案 A · PR-A3 · 知识库列表 + 新建
// 5.30up · B 半 RBAC 改造（R2 通过）：
//   - org_admin 可见 = 平台公共（tenant_code IS NULL）+ 本组织（tenant_code = admin.tenantCode）
//   - org_admin 写 = 仅 own；自动注入 tenant_code = 自己 org
//   - super/system 沿用全可见 + 可显式赋 tenant_code（先 validateTenantCode）
//   - 写白名单含 system_admin（KB 与 API 管理不同，沿用 KB 现状全写）

const KB_WRITE_ROLES = ["super_admin", "system_admin", "org_admin"] as const;

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  // 5.30up · B 半：所有 admin 角色都能读（含 org_admin），按 ownership 过滤
  const statusParam = req.nextUrl.searchParams.get("status");
  let query = db
    .from("knowledge_bases")
    .select("*")
    .order("created_at", { ascending: false });
  if (statusParam === "active" || statusParam === "disabled") {
    query = query.eq("status", statusParam);
  }
  // 5.30up · 接 listScopeFilter：org_admin 自动加 ownership 过滤；super/system 不动
  const scope = listScopeFilter(admin);
  if (scope) query = query.or(scope);

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

  // 5.30up · R2 §1 双闸门：角色白名单 + org_admin tenantCode 非空兜底
  const gate = requireWriteAccess(admin, [...KB_WRITE_ROLES]);
  if (gate) return gate;

  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const description = String(body.description ?? "").trim();
  if (!name) return apiError("知识库名称不能为空", "VALIDATION_ERROR");
  if (name.length > 100) return apiError("知识库名称过长（上限 100 字）", "VALIDATION_ERROR");

  // 5.30up · R2 §6 · 显式 tenant_code 入参先校验 tenants.code 存在性（super/system 才走到）
  if (typeof body.tenant_code === "string" && body.tenant_code.trim() !== "") {
    const ok = await validateTenantCode(body.tenant_code);
    if (!ok) {
      return apiError(
        `组织代码「${body.tenant_code}」不存在或已失效，无法创建归属此组织的知识库`,
        "VALIDATION_ERROR"
      );
    }
  }

  // 5.30up · 计算 ownership：org_admin 强制本组织；super/system 沿用 payload
  let ownership: { tenant_code: string | null };
  try {
    ownership = resolveCreateOwnership(admin, {
      tenant_code: typeof body.tenant_code === "string" ? body.tenant_code : null,
    });
  } catch (e) {
    if (e instanceof ScopeAdminNoTenantError) {
      return apiError("组织管理员未绑定组织，无法创建知识库", "FORBIDDEN");
    }
    throw e;
  }

  // 5.30up · R2 §6 · org_admin 路径：admin.tenantCode 也校验存在性（防 admin 绑定的 org 已删）
  if (admin.role === "org_admin" && ownership.tenant_code) {
    const ok = await validateTenantCode(ownership.tenant_code);
    if (!ok) {
      return apiError(
        "您所属的组织不存在或已失效，请联系平台管理员",
        "FORBIDDEN"
      );
    }
  }

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
    .insert({
      name,
      description,
      embedding_model,
      created_by: admin.adminId,
      tenant_code: ownership.tenant_code, // 5.30up · 写入归属
    })
    .select("*")
    .single();
  if (error) {
    console.error("[knowledge-bases create]", error);
    return apiError("创建知识库失败", "INTERNAL_ERROR");
  }

  // 5.30up · R2 §5 · KB 写路径补审计（原 KB 路由根本没写）
  await writeAuditLog({
    adminId: admin.adminId,
    adminUsername: admin.username,
    adminRole: admin.role,
    adminTenantCode: admin.tenantCode ?? null,
    resourceTenantCode: ownership.tenant_code, // KB 已含 tenant_code，但显式传更稳
    action: "create",
    resourceType: "knowledge_base",
    resourceId: data.id,
    resourceName: name,
    detail: { embedding_model },
  });

  return NextResponse.json({ ...data, document_count: 0 });
}
