export type UserInfo = {
  userId: string;
  phone: string;
  tenantCode: string;
  tenantName: string;
  isPersonal: boolean;
  role: "super_admin" | "system_admin" | "org_admin" | "user";
  userType: "personal" | "organization";
  quota: { total: number; used: number; left: number; expiresAt: string } | null;
};

export type AgentItem = {
  id: string;
  agent_code: string;
  name: string;
  description: string;
  platform: string;
  agent_type?: string;
  external_url?: string;
  categories?: { name: string; icon_url?: string | null };
  categoriesAll?: { id: string; name: string; icon_url: string | null }[];
};

export type CategoryItem = { id: string; name: string; icon_url?: string | null };
export type NoticeItem = { id: string; tenant_code: string | null; content: string; enabled: boolean };

export type UserAgentItem = {
  id: string;
  name: string;
  description: string;
  agent_type: "chat" | "external";
  platform: string;
  api_url: string;
  external_url: string;
  model_params?: Record<string, unknown>;
  has_api_key?: boolean;
};

export type WorkflowStep = {
  id: string;
  step_order: number;
  title: string;
  description: string;
  exec_type: "agent" | "manual" | "review" | "external";
  agent_id: string | null;
  button_text: string;
  enabled: boolean;
  agents?: { id: string; agent_code: string; name: string; agent_type: string; external_url: string } | null;
};

export type WorkflowItem = {
  id: string;
  name: string;
  description: string;
  category: string;
  workflow_steps: WorkflowStep[];
};
