import { KnowledgeBaseWorkbench } from "@/components/admin/knowledge-base-workbench";

export default async function KnowledgeBaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <KnowledgeBaseWorkbench initialKbId={id} />;
}
