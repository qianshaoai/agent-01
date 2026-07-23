import { AgentCenterWorkbench } from "@/components/admin/agent-center-workbench";
import { AdminPageFrame as AdminLayout } from "@/components/layout/admin-layout";

export default function AgentCenterPage() {
  return (
    <AdminLayout>
      <AgentCenterWorkbench />
    </AdminLayout>
  );
}
