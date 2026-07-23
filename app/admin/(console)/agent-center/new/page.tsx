import { Suspense } from "react";
import { AgentCenterEditor } from "@/components/admin/agent-center-editor";
import { AdminPageFrame as AdminLayout } from "@/components/layout/admin-layout";

export default function AgentCenterNewPage() {
  return (
    <AdminLayout>
      <Suspense fallback={<div className="h-40 rounded-[16px] bg-white shadow-sm" />}>
        <AgentCenterEditor />
      </Suspense>
    </AdminLayout>
  );
}
