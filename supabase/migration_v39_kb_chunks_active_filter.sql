-- 5.19up · 知识库方案 A · 小B 验收 finding 1 收口
-- 来自 5.19up 方案 A 小B 验收（detail：knowledge_bases.status='disabled' 后检索仍命中）
-- 改动：match_kb_chunks RPC 加 knowledge_bases.status='active' 过滤
-- 数据迁移：无（仅替换函数体；签名 / 返回字段保持冻结契约不变）
--
-- 背景：chat route 是方案 B 文件，方案 A 不得修改（约束 §九.1）。把过滤压到 RPC 里
--      —— 签名不变，B 那边代码零改动即可获得"停用知识库不参与检索"的语义。

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
    -- 小B finding 1：停用（status='disabled'）的知识库不参与检索
    AND EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE kb.id = c.kb_id AND kb.status = 'active'
    )
  ORDER BY c.embedding <=> p_query
  LIMIT GREATEST(p_top_k, 1);
$$;

NOTIFY pgrst, 'reload schema';
