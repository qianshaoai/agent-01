import { getCurrentUser, UserPayload } from "@/lib/auth";
import { db } from "@/lib/db";

// UserPayload enriched with DB-fresh status and nickname.
// Use this in API routes that must enforce account status.
export type ActiveUser = UserPayload & {
  nickname: string;
  status: "active";
  createdAt: string | null;
};

export async function getActiveUser(): Promise<ActiveUser | null> {
  const payload = await getCurrentUser();
  if (!payload) return null;

  const { data: dbUser } = await db
    .from("users")
    .select("status, nickname, created_at, role, user_type")
    .eq("id", payload.userId)
    .single();

  if (!dbUser || dbUser.status !== "active") return null;

  return {
    ...payload,
    // role 和 userType 从数据库实时读取，不依赖 JWT
    role: dbUser.role ?? "user",
    userType: dbUser.user_type ?? "personal",
    nickname: dbUser.nickname ?? "",
    status: "active" as const,
    createdAt: dbUser.created_at ?? null,
  };
}
