import { dbError, apiError, parsePagination, paginatedResponse } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

  const { page, pageSize, start } = parsePagination(req, 100);
  const { data, count } = await db
    .from("tenants")
    .select("id, code, name, quota, quota_used, expires_at, enabled, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(start, start + pageSize - 1);

  return paginatedResponse(data ?? [], count ?? 0, page, pageSize);
}

export async function POST(req: NextRequest) {
  { const _a = await requireAdmin(); if (_a instanceof Response) return _a; }

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
