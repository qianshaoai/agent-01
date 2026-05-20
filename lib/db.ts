import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * 自定义 fetch：在 fetch 抛错（ECONNRESET / ETIMEDOUT / TLS handshake 失败等
 * 跨境网络层错误）时自动重试 3 次，每次间隔 200ms / 400ms 退避。
 *
 * 仅捕获 fetch 抛错的情况；HTTP 4xx / 5xx 不会触发 fetch throw，由调用方自行处理。
 * 这是 dev 环境跨境访问 Supabase 时的稳态修复（prod 环境无此问题，无副作用）。
 */
async function retryingFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetch(input, init);
    } catch (e) {
      lastErr = e;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

// 服务端专用客户端（使用 service_role key，绕过 RLS）
export const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
  global: { fetch: retryingFetch },
});

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export type Tenant = {
  id: string;
  code: string;
  name: string;
  pwd_hash: string;
  quota: number;
  quota_used: number;
  expires_at: string;
  enabled: boolean;
  created_at: string;
};

export type User = {
  id: string;
  phone: string;
  tenant_code: string;
  pwd_hash: string;
  first_login: boolean;
  created_at: string;
};

export type Admin = {
  id: string;
  username: string;
  pwd_hash: string;
};

export type Category = {
  id: string;
  name: string;
  sort_order: number;
};

export type Agent = {
  id: string;
  agent_code: string;
  name: string;
  description: string;
  category_id: string | null;
  platform: string;
  api_endpoint: string;
  api_key_enc: string;
  model_params: Record<string, unknown>;
  enabled: boolean;
  categories?: { name: string };
};

export type Conversation = {
  id: string;
  user_id: string;
  agent_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

export type Notice = {
  id: string;
  tenant_code: string | null;
  content: string;
  enabled: boolean;
  created_at: string;
};

export type Log = {
  id: string;
  user_phone: string | null;
  tenant_code: string | null;
  agent_code: string | null;
  agent_name: string | null;
  action: string;
  status: "success" | "error";
  duration_ms: number | null;
  error_msg: string | null;
  created_at: string;
};
