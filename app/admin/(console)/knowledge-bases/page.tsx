// 路由组不改变公开 URL，仅让后台 Shell 跨页面保持挂载。
import { KnowledgeBaseWorkbench } from "@/components/admin/knowledge-base-workbench";

export default function KnowledgeBasesPage() {
  return <KnowledgeBaseWorkbench />;
}
