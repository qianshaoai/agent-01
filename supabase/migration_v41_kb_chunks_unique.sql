-- migration_v41 · 5.28up Fix 3 · kb_chunks 加 (document_id, chunk_index) UNIQUE 约束
-- 表：kb_chunks
-- 改动：UNIQUE INDEX uniq_kb_chunks_doc_chunk ON kb_chunks(document_id, chunk_index)
-- 数据迁移：建索引前需先去重（极少情况下：旧版 reindex 并发跑同一文档可能造成重复
--              片段；本脚本对每对 (document_id, chunk_index) 保留 id 最大的那行，删旧）
--
-- 起因：reindex 接口 5.28up 已经在服务端加了原子状态翻转（done/failed → pending）防
--   多 tab 并发，但走旧版本 bug / 未来误操作仍可能造成同一文档同一 chunk_index 出现
--   多条记录 —— 检索时会拿到重复段、挤占 prompt 空间。DB 层加 UNIQUE 兜底。

-- 1. 去重保留 id 最大行（reindex 后插的 id 比旧的大；保留新的）
DELETE FROM kb_chunks a
USING kb_chunks b
WHERE a.document_id = b.document_id
  AND a.chunk_index = b.chunk_index
  AND a.id < b.id;

-- 2. 加 UNIQUE 索引（幂等：用 IF NOT EXISTS）
CREATE UNIQUE INDEX IF NOT EXISTS uniq_kb_chunks_doc_chunk
  ON kb_chunks(document_id, chunk_index);

NOTIFY pgrst, 'reload schema';
