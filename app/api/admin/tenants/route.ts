import { dbError, apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const { page, pageSize, start } = parsePagination(req, 100);
  let query = db
    .from("tenants")
    .select("id, code, name, quota, quota_used, expires_at, enabled, created_at", { count: "exact" })
    .order("created_at", { ascending: false });

  // 5.7up · org_admin 只能看到自己组织那一行
  if (admin.role === "org_admin") {
    if (!admin.tenantCode) return apiError("组织管理员未绑定组织", "FORBIDDEN");
    query = query.eq("code", admin.tenantCode);
  }

  const { data, count } = await query.range(start, start + pageSize - 1);

  return paginatedResponse(data ?? [], count ?? 0, page, pageSize);
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  // 5.7up · org_admin 不可创建组织
  if (admin.role === "org_admin") {
    return apiError("无权创建组织", "FORBIDDEN");
  }

  const { code, name, initialPwd, quota, expiresAt } = await req.json();
  if (!code || !name || !initialPwd || !quota || !expiresAt) {
    return apiError("请填写所有必填字段", "VALIDATION_ERROR");
  }

  if (!/^[A-Za-z]{4,8}$/.test(code.trim())) {
    return apiError("组织码只能为 4~8 位英文字母", "VALIDATION_ERROR");
  }

  const normalizedCode = code.trim().toUpperCase();
  const pwdHash = await bcrypt.hash(initialPwd, 12);

  const { data, error } = await db
    .from("tenants")
    .insert({
      code: normalizedCode,
      name,
      pwd_hash: pwdHash,
      quota: Number(quota),
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiError("组织码已存在", "CONFLICT");
    }
    return dbError(error);
  }

  return NextResponse.json(data, { status: 201 });
}
