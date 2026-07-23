"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminPageFrame as AdminLayout } from "@/components/layout/admin-layout";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ArrowLeft, Hammer, Plus, Copy, Trash2, Edit, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useSubmitGuard } from "@/lib/hooks/use-submit-guard";
import { useAdminPermissions } from "@/lib/hooks/use-admin-permissions";

// 5.14up PR-B · 智能体搭建器 · 草稿列表
// 权限：super_admin + system_admin

type Draft = {
  id: string;
  name: string;
  description: string;
  provider_id: string | null;
  agent_type: "chat" | "external";
  status: "draft" | "testing" | "published" | "archived";
  published_agent_id: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_LABEL: Record<Draft["status"], { text: string; cls: string }> = {
  draft:     { text: "草稿",     cls: "bg-gray-100 text-gray-600" },
  testing:   { text: "测试中",   cls: "bg-blue-50 text-blue-600" },
  published: { text: "已发布",   cls: "bg-green-50 text-green-700" },
  archived:  { text: "已归档",   cls: "bg-gray-50 text-gray-400" },
};

export default function AgentBuilderListPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [list, setList] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  // 5.27up Fix · 防重复提交：A useRef 同步锁 + B 客户端幂等键，详见 lib/hooks/use-submit-guard.ts
  const createGuard = useSubmitGuard();
  const duplicateGuard = useSubmitGuard();
  const adminPerms = useAdminPermissions();
  const canReadDrafts = adminPerms.canAction("agent_draft", "read");
  const canUpdateDraft = adminPerms.canAction("agent_draft", "update");
  const canDeleteDraft = adminPerms.canAction("agent_draft", "delete");
  const canCreateDraft =
    canReadDrafts &&
    canUpdateDraft &&
    adminPerms.canAction("agent_draft", "create");
  const canDuplicateDraft =
    canReadDrafts &&
    canUpdateDraft &&
    adminPerms.canAction("agent_draft", "duplicate");

  const loadList = useCallback(async () => {
    if (!adminPerms.loaded) return;
    if (!canReadDrafts) {
      setList([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    // 重试 3 次：Supabase 在国内代理下间歇 ECONNRESET，单次失败概率高
    // 三次都失败才弹 toast 报错，避免每次刷新都误报"获取列表失败"
    let lastErr: unknown = null;
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch("/api/admin/agent-drafts", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "加载失败");
        setList(data.data ?? []);
        setLoading(false);
        return;
      } catch (e: unknown) {
        lastErr = e;
        if (i < 2) await new Promise((r) => setTimeout(r, 300));
      }
    }
    toast(lastErr instanceof Error ? lastErr.message : "加载失败", "error");
    setLoading(false);
  }, [adminPerms.loaded, canReadDrafts, toast]);

  useEffect(() => { loadList(); }, [loadList]);

  async function create() {
    if (!canCreateDraft) {
      toast("权限不足", "error");
      return;
    }
    await createGuard.submit(async (idempotencyKey) => {
      try {
        const res = await fetch("/api/admin/agent-drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ name: "未命名智能体" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "创建失败");
        router.push(`/admin/agent-builder/${data.id}`);
      } catch (e: unknown) {
        toast(e instanceof Error ? e.message : "创建失败", "error");
      }
    });
  }

  async function duplicate(d: Draft) {
    if (!canDuplicateDraft) {
      toast("权限不足", "error");
      return;
    }
    await duplicateGuard.submit(async (idempotencyKey) => {
      try {
        const res = await fetch(`/api/admin/agent-drafts/${d.id}/duplicate`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "复制失败");
        toast("草稿已复制", "success");
        await loadList();
      } catch (e: unknown) {
        toast(e instanceof Error ? e.message : "复制失败", "error");
      }
    });
  }

  async function remove(d: Draft) {
    if (!canDeleteDraft) {
      toast("权限不足", "error");
      return;
    }
    const isPublished = d.status === "published";
    const msg = isPublished
      ? `这个草稿已发布为正式智能体，删除会归档草稿（保留发布关系）。确认？`
      : `确认删除草稿「${d.name}」？此操作不可恢复。`;
    if (!confirm(msg)) return;
    try {
      const res = await fetch(`/api/admin/agent-drafts/${d.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "删除失败");
      toast(isPublished ? "草稿已归档" : "草稿已删除", "success");
      await loadList();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "删除失败", "error");
      // 失败也刷一下列表：可能是 stale 数据（DB 里草稿其实早不在了，前端没同步）
      await loadList();
    }
  }

  return (
    <AdminLayout>
      <div className="max-w-6xl space-y-6">
        <PageHeader
          icon={<Hammer size={20} />}
          title="智能体搭建"
          actions={
            <>
              <Link href="/admin/agent-center">
                <Button variant="outline" className="flex items-center gap-1.5">
                  <ArrowLeft size={16} /> 返回智能体管理
                </Button>
              </Link>
              {canCreateDraft ? (
                <Button onClick={create} loading={createGuard.loading} className="flex items-center gap-1.5">
                  <Plus size={16} /> 新建智能体
                </Button>
              ) : null}
            </>
          }
        />

        {!adminPerms.loaded || loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <Loader2 className="animate-spin mr-2" size={20} /> 加载中…
          </div>
        ) : !canReadDrafts ? (
          <div className="card p-12 text-center text-gray-400">
            无权访问智能体搭建
          </div>
        ) : list.length === 0 ? (
          <div className="card p-12 text-center text-gray-400">
            {canCreateDraft
              ? "还没有任何智能体，点右上角「新建智能体」开始搭建第一个智能体"
              : "暂无可查看的智能体草稿"}
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm table-fixed">
              {/* 6.5up · 固定列宽，避免长 description 撑爆名称列、把状态/类型挤成竖排
                  仿 app/admin/agents/page.tsx 6.3up 同款 colgroup 模式 */}
              <colgroup>
                <col className="w-[38%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[20%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">名称</th>
                  <th className="px-4 py-3 text-left font-medium">状态</th>
                  <th className="px-4 py-3 text-left font-medium">类型</th>
                  <th className="px-4 py-3 text-left font-medium">最近修改</th>
                  <th className="px-4 py-3 text-left font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {list.map((d) => {
                  const s = STATUS_LABEL[d.status];
                  return (
                    <tr key={d.id}>
                      <td className="px-4 py-3">
                        {canUpdateDraft ? (
                          <Link
                            href={`/admin/agent-builder/${d.id}`}
                            className="font-medium text-gray-900 hover:text-[#002FA7]"
                          >
                            {d.name || "未命名智能体"}
                          </Link>
                        ) : (
                          <span className="font-medium text-gray-900">
                            {d.name || "未命名智能体"}
                          </span>
                        )}
                        {d.description && (
                          <div className="text-xs text-gray-400 truncate mt-0.5" title={d.description}>{d.description}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs ${s.cls}`}>{s.text}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {d.agent_type === "external" ? "外链跳转" : "对话型"}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {new Date(d.updated_at).toLocaleString("zh-CN", { hour12: false })}
                      </td>
                      <td className="px-4 py-3">
                        {!canUpdateDraft && !canDuplicateDraft && !canDeleteDraft ? (
                          <span className="text-xs text-gray-300">仅可查看</span>
                        ) : (
                          <div className="flex items-center gap-3">
                            {canUpdateDraft && (
                              <Link
                                href={`/admin/agent-builder/${d.id}`}
                                className="text-xs text-[#002FA7] hover:underline inline-flex items-center gap-1"
                              >
                                <Edit size={12} /> 编辑
                              </Link>
                            )}
                            {canDuplicateDraft && (
                              <button
                                onClick={() => duplicate(d)}
                                className="text-xs text-gray-600 hover:text-[#002FA7] inline-flex items-center gap-1"
                              >
                                <Copy size={12} /> 复制
                              </button>
                            )}
                            {canDeleteDraft && (
                              <button
                                onClick={() => remove(d)}
                                className="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1"
                              >
                                <Trash2 size={12} /> 删除
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
