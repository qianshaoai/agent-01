-- migration_v40 · 5.28up · kb_documents 加 total_chunks 列
-- 表：kb_documents
-- 改动：加列 total_chunks INT NOT NULL DEFAULT 0
-- 数据迁移：不需要 —— 老行 total_chunks=0；新行 ingest 期间会即时填
--
-- 起因：A · ingest 改后台异步后，前端要轮询显示「已完成 N/总数 段」进度。
--   chunk_count 仍承担"已完成数"语义，新加 total_chunks 承担"总数"语义。
--   不破坏旧数据：老文档 total_chunks=0 时前端回退到"已完成 N 段"无总数显示。

ALTER TABLE kb_documents
  ADD COLUMN IF NOT EXISTS total_chunks INT NOT NULL DEFAULT 0;
