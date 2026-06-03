-- migration_v45 · 6.4up R1.2 · KB 会话级记忆池
--
-- 目标：让多轮对话中 KB 信息可累积（2-B+ 大记忆池 / 小注入窗口）
--   - 新表 kb_context_state（conversation × chunk 维度）
--   - 不存 chunk content，只存 chunk_id + 元数据（first_seen_at / last_hit_at /
--     hit_count / last_similarity），每轮注入前回查 kb_chunks 拿正文
--   - ON DELETE CASCADE 保证 conversation 删 / chunk 删时池自动清理
--
-- 3 个 RPC 配套：
--   1. bump_kb_context_state(jsonb)  · atomic upsert + hit_count++ + is_current
--      控制 last_similarity 写入（R1.2-5 fail-loud cast）
--   2. trim_kb_context_state(uuid, int) · 池容量裁剪（按 last_hit_at asc 删旧）
--   3. rank_kb_context_chunks(uuid[], vector, uuid[]) · 池内 chunks 用本轮 query
--      embedding 重算 cosine（R1.2-2 解决"旧资料随机复活"）
--
-- 与 migration_v42 RPC 过滤口径完全一致：active KB + done 文档（双 EXISTS）
--
-- 数据迁移：无 —— 新表 + 新 RPC，不动既有数据
-- 幂等：表 IF NOT EXISTS + 索引 IF NOT EXISTS + RPC CREATE OR REPLACE

BEGIN;

-- ── 1. 会话级 KB 记忆池表 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS kb_context_state (
  conversation_id  UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  chunk_id         UUID        NOT NULL REFERENCES kb_chunks(id)     ON DELETE CASCADE,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_hit_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hit_count        INT         NOT NULL DEFAULT 1,
  last_similarity  REAL        NOT NULL DEFAULT 0,   -- 0..1 余弦相似度，仅 RPC 命中时更新
  PRIMARY KEY (conversation_id, chunk_id)
);

-- 池查询主索引：拉某 conversation 的池（按最近活跃 desc）
CREATE INDEX IF NOT EXISTS kb_context_state_conv_time_idx
  ON kb_context_state (conversation_id, last_hit_at DESC);

-- 备用索引：按 hit_count 排序（统计 / 调试用，不强需）
CREATE INDEX IF NOT EXISTS kb_context_state_conv_hits_idx
  ON kb_context_state (conversation_id, hit_count DESC);

-- ── 2. RPC · bump_kb_context_state ────────────────────────────
-- atomic upsert 一批行：
--   - 新 chunk → INSERT first_seen_at=last_hit_at=now, hit_count=1
--   - 旧 chunk → UPDATE last_hit_at=now, hit_count+=1
--   - last_similarity 仅 is_current=true 时覆盖；否则保留旧值
--
-- 输入示例：
--   [{ "conversation_id": "...", "chunk_id": "...", "last_hit_at": "2026-06-03T...",
--      "is_current": true, "new_similarity": 0.72 },
--    { "conversation_id": "...", "chunk_id": "...", "last_hit_at": "2026-06-03T...",
--      "is_current": false, "new_similarity": null }]
--
-- 缺字段 cast 会失败 → fail-loud，比 COALESCE 静默兜底更安全
CREATE OR REPLACE FUNCTION bump_kb_context_state(p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE r jsonb;
BEGIN
  FOR r IN SELECT jsonb_array_elements(p_rows) LOOP
    INSERT INTO kb_context_state (
      conversation_id, chunk_id, first_seen_at, last_hit_at, hit_count, last_similarity
    ) VALUES (
      (r->>'conversation_id')::uuid,
      (r->>'chunk_id')::uuid,
      (r->>'last_hit_at')::timestamptz,
      (r->>'last_hit_at')::timestamptz,
      1,
      CASE WHEN (r->>'is_current')::boolean
           THEN COALESCE((r->>'new_similarity')::real, 0)
           ELSE 0 END
    )
    ON CONFLICT (conversation_id, chunk_id) DO UPDATE SET
      last_hit_at = EXCLUDED.last_hit_at,
      hit_count   = kb_context_state.hit_count + 1,
      last_similarity = CASE
        WHEN (r->>'is_current')::boolean THEN (r->>'new_similarity')::real
        ELSE kb_context_state.last_similarity
      END;
  END LOOP;
END;
$$;

-- ── 3. RPC · trim_kb_context_state ────────────────────────────
-- 池容量裁剪：单 conversation 内按 last_hit_at desc 排，仅保留前 p_max_size 行，
-- 其它（rn > p_max_size）整批删除。
--
-- 走 window function 而非 LIMIT/OFFSET 子查询，便于 PG planner 优化（命中
-- kb_context_state_conv_time_idx）。
CREATE OR REPLACE FUNCTION trim_kb_context_state(
  p_conversation_id UUID,
  p_max_size        INT
)
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM kb_context_state
  WHERE (conversation_id, chunk_id) IN (
    SELECT conversation_id, chunk_id FROM (
      SELECT
        conversation_id,
        chunk_id,
        ROW_NUMBER() OVER (
          PARTITION BY conversation_id
          ORDER BY last_hit_at DESC
        ) AS rn
      FROM kb_context_state
      WHERE conversation_id = p_conversation_id
    ) t
    WHERE rn > p_max_size
  );
$$;

-- ── 4. RPC · rank_kb_context_chunks ───────────────────────────
-- 给定 chunk_ids + 本轮 query 向量，对池内 chunks 重算与当前 query 的余弦相似度。
--
-- 与 match_kb_chunks 区别：
--   - 不按距离排序、不按 threshold 过滤（业务层用 score 排序时决定）
--   - 入参 chunk_ids 严格圈定范围（池里的 chunks 才参与）
--
-- 过滤口径与 match_kb_chunks 一致：
--   - kb_id ∈ p_kb_ids（agent 当前绑定的 KB）
--   - knowledge_bases.status='active'
--   - kb_documents.status='done'
--   - chunk.embedding 非 NULL
--
-- 用途：业务层（chat route）合并「本轮 RPC 命中 + 池内重排结果」进入综合排序
CREATE OR REPLACE FUNCTION rank_kb_context_chunks(
  p_chunk_ids UUID[],
  p_query     vector,
  p_kb_ids    UUID[]
)
RETURNS TABLE (
  id                 UUID,
  current_similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    1 - (c.embedding <=> p_query) AS current_similarity
  FROM kb_chunks c
  WHERE c.id = ANY(p_chunk_ids)
    AND c.kb_id = ANY(p_kb_ids)
    AND c.embedding IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE kb.id = c.kb_id AND kb.status = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM kb_documents d
      WHERE d.id = c.document_id AND d.status = 'done'
    );
$$;

COMMIT;

-- ── 5. PostgREST schema reload ───────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ── 6. 验证 ───────────────────────────────────────────────────
-- 跑完后执行以下任一查询确认成功：
--   SELECT to_regclass('kb_context_state');                              -- 应返回 'kb_context_state'
--   SELECT proname FROM pg_proc WHERE proname IN (
--     'bump_kb_context_state', 'trim_kb_context_state', 'rank_kb_context_chunks'
--   );                                                                   -- 应返回 3 行
--   \d kb_context_state                                                  -- 看表结构
