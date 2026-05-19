-- 5.19up · 智能体知识库（RAG）· 方案 A · PR-A1 向量基建
-- 来自 5.19up 知识库方案 A（知识库与摄取）
-- 改动表：启用 pgvector 扩展；新增 knowledge_bases / kb_documents / kb_chunks /
--         agent_knowledge_bases 4 表；model_providers.category CHECK 加 'embedding'
-- 数据迁移：无（纯新增；CHECK 放宽不影响存量行）
--
-- 决策依据（5/19 拍板，见 5.19up/智能体知识库-方案A 与 并行开发统一约束）：
--   D1   智谱 embedding，向量维度 1024（pgvector HNSW 索引上限 2000，2048 不可索引）
--   D1-2 embedding 配置并进 API 管理 → model_providers 加 category='embedding'
--
-- 幂等：扩展 / 表 / 约束 / 索引 / 函数均 IF [NOT] EXISTS 或 OR REPLACE，可安全重跑。

-- ─── 0. pgvector 扩展 ───────────────────────────────────────────────────────
-- 若 SQL Editor 报权限错，先在 Supabase Dashboard > Database > Extensions 启用 vector
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── 1. knowledge_bases 知识库 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_bases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  -- 建库时用的 embedding 模型名（全站统一，仅作记录 —— 全局模型变更时据此识别需重建的库）
  embedding_model  TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2. kb_documents 知识库文档 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kb_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kb_id         UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  file_type     TEXT NOT NULL DEFAULT '',
  storage_path  TEXT NOT NULL DEFAULT '',
  -- pending 待摄取 / indexing 摄取中 / done 完成 / failed 失败（超 D9 上限、提取失败等）
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'indexing', 'done', 'failed')),
  chunk_count   INT NOT NULL DEFAULT 0,
  char_count    INT NOT NULL DEFAULT 0,
  error_msg     TEXT NOT NULL DEFAULT '',
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS kb_documents_kb_id_idx ON kb_documents(kb_id);

-- ─── 3. kb_chunks 文档切片（带向量）───────────────────────────────────────
CREATE TABLE IF NOT EXISTS kb_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  kb_id        UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  chunk_index  INT NOT NULL,
  content      TEXT NOT NULL,
  token_count  INT NOT NULL DEFAULT 0,
  -- D1：智谱 embedding，1024 维。pgvector HNSW / ivfflat 索引上限 2000 维
  embedding    vector(1024),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS kb_chunks_kb_id_idx       ON kb_chunks(kb_id);
CREATE INDEX IF NOT EXISTS kb_chunks_document_id_idx ON kb_chunks(document_id);
-- HNSW 向量索引（余弦距离）—— 检索 RPC match_kb_chunks 用
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_idx
  ON kb_chunks USING hnsw (embedding vector_cosine_ops);

-- ─── 4. agent_knowledge_bases 智能体↔知识库 关联 ──────────────────────────
-- 表由方案 A 创建；业务写入（发布同步）由方案 B 负责，A 不写该表
CREATE TABLE IF NOT EXISTS agent_knowledge_bases (
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kb_id       UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agent_id, kb_id)
);
CREATE INDEX IF NOT EXISTS agent_knowledge_bases_kb_id_idx ON agent_knowledge_bases(kb_id);

-- 关闭 RLS（全站服务端用 service_role 访问，与既有表口径一致）
ALTER TABLE knowledge_bases       DISABLE ROW LEVEL SECURITY;
ALTER TABLE kb_documents          DISABLE ROW LEVEL SECURITY;
ALTER TABLE kb_chunks             DISABLE ROW LEVEL SECURITY;
ALTER TABLE agent_knowledge_bases DISABLE ROW LEVEL SECURITY;

-- ─── 5. model_providers.category 加 'embedding' ───────────────────────────
-- D1-2：embedding 配置并进 API 管理。v37 的 CHECK 只允许 model/agent，这里放宽
ALTER TABLE model_providers
  DROP CONSTRAINT IF EXISTS model_providers_category_check;
ALTER TABLE model_providers
  ADD CONSTRAINT model_providers_category_check
  CHECK (category IN ('model', 'agent', 'embedding'));

-- ─── 6. match_kb_chunks 检索 RPC ──────────────────────────────────────────
-- 签名见「并行开发统一约束」§三.2，冻结契约，A / B 均不得擅改。
-- 方案 B 通过 lib/kb/retrieve.ts 调用；按余弦相似度取 top-K，过滤低于阈值的片段。
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
  ORDER BY c.embedding <=> p_query
  LIMIT GREATEST(p_top_k, 1);
$$;

-- 让 PostgREST 立即识别新表与新 RPC
NOTIFY pgrst, 'reload schema';
