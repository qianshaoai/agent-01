-- migration_v42 · 5.28up 小B 复审 Fix 1
-- 表：match_kb_chunks RPC（不动 kb_chunks / kb_documents 数据）
-- 改动：RPC 加 kb_documents.status='done' 过滤
-- 数据迁移：无 —— 仅替换函数体；签名 / 返回字段保持冻结契约不变
--
-- 起因：5.28up A · ingest 分批 insert，中途任一批失败 → 文档 status='failed'，
--   但已 insert 的半截 chunks 不会被回滚。检索 RPC（v39 版本）只过滤知识库
--   active，不过滤文档 done 状态 → 失败 / 索引中文档的部分 chunks 可能被检索
--   到、出现在 chat 引用里。
--
--   v42 加 d.status='done' 过滤后，只有完整索引完成的文档才参与检索。
--   配合 ingest.ts 内 fail() 主动清理 chunks（代码层 5.28up Fix 1），双保险。

CREATE OR REPLACE FUNCTION match_kb_chunks(
  p_kb_ids    UUID[],
  p_query     vector,
  p_top_k     INT,
  p_threshold FLOAT
)
RETURNS TABLE (
  id          UUID,
  document_id UUID,
  kb_id       UUID,
  content     TEXT,
  similarity  FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.document_id,
    c.kb_id,
    c.content,
    1 - (c.embedding <=> p_query) AS similarity
  FROM kb_chunks c
  WHERE c.kb_id = ANY(p_kb_ids)
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> p_query) >= p_threshold
    -- v39 finding 1：停用知识库不参与检索
    AND EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE kb.id = c.kb_id AND kb.status = 'active'
    )
    -- 5.28up 小B 复审 Fix 1：只检索状态 done 的完整文档；pending / indexing /
    --   failed 文档可能有半截 chunks（A 分批 insert 中途崩 / 还没跑完），不能参与
    AND EXISTS (
      SELECT 1 FROM kb_documents d
      WHERE d.id = c.document_id AND d.status = 'done'
    )
  ORDER BY c.embedding <=> p_query
  LIMIT GREATEST(p_top_k, 1);
$$;

NOTIFY pgrst, 'reload schema';
