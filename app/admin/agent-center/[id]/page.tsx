import { Suspense } from "react";
import { AgentCenterEditor } from "@/components/admin/agent-center-editor";
import { AdminLayout } from "@/components/layout/admin-layout";

export default async function AgentCenterEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AdminLayout>
      <Suspense fallback={<div className="h-40 rounded-[16px] bg-white shadow-sm" />}>
        <AgentCenterEditor agentId={id} />
      </Suspense>
    </AdminLayout>
  );
}
