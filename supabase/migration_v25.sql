-- ============================================================================
-- migration_v25 · 5.7up · GPT 接入阶段一
-- 改动表：tenants（+3 列）, logs（+3 列）, 新建 model_quota_weights 表
-- 数据迁移：种子两条权重（gpt-4o-mini=1, gpt-4o=5）；不动既有数据
-- 跑法：Supabase Dashboard > SQL Editor 整段粘贴执行（幂等可重跑）
-- ============================================================================

-- ── 1. tenants 加 OpenAI key 字段 ────────────────────────────────
-- openai_key_enc：AES-256-GCM 密文（lib/crypto.ts 编解码），格式 "iv:authTag:cipher" hex
-- openai_key_set_at / set_by：审计用，super_admin 配置 / 更新时写
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS openai_key_enc TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS openai_key_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS openai_key_set_by UUID;

-- ── 2. logs 加 token / 模型字段 ──────────────────────────────────
-- 仅 GPT 类调用会填这三列；其它平台保持 NULL
ALTER TABLE logs
  ADD COLUMN IF NOT EXISTS prompt_tokens INT,
  ADD COLUMN IF NOT EXISTS completion_tokens INT,
  ADD COLUMN IF NOT EXISTS model_used TEXT;

-- ── 3. 模型权重表（加权 quota 的核心配置）────────────────────────
-- weight_per_call：一次调用扣多少次 tenants.quota
-- enabled：默认是否对全平台可用；后续可在此基础上叠加按租户的开关（v26 再说）
CREATE TABLE IF NOT EXISTS model_quota_weights (
  model_id        TEXT PRIMARY KEY,
  weight_per_call INT NOT NULL CHECK (weight_per_call > 0),
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 种子：阶段一只开两个模型
-- 价比基准：gpt-4o-mini ≈ $0.15/1M input ⇒ 权重 1
--           gpt-4o      ≈ $2.50/1M input ⇒ 权重 5（约相当于 17 倍价格按 5 倍计，做了一次性能/价格折中）
INSERT INTO model_quota_weights (model_id, weight_per_call, enabled, note) VALUES
  ('gpt-4o-mini', 1, TRUE,  '日常对话主力'),
  ('gpt-4o',      5, TRUE,  '复杂任务（长文档/写作/代码）'),
  ('o1-preview', 30, FALSE, '推理类，默认不开；需启用前确认承担成本'),
  ('o1-mini',    15, FALSE, '推理类轻量版，默认不开')
ON CONFLICT (model_id) DO NOTHING;

-- ── 4. 加权扣额度 RPC ────────────────────────────────────────────
-- 与现有 increment_quota_used(p_code) 并存：单平台调一次仍走旧 RPC（隐式 weight=1）
-- GPT 平台调用走这个新 RPC，按模型权重扣
CREATE OR REPLACE FUNCTION increment_quota_used_weighted(p_code TEXT, p_weight INT)
RETURNS boolean AS $$
DECLARE
  affected INT;
BEGIN
  IF p_weight IS NULL OR p_weight <= 0 THEN
    RETURN FALSE;
  END IF;

  UPDATE tenants
  SET quota_used = quota_used + p_weight
  WHERE code = p_code AND (quota_used + p_weight) <= quota;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$ LANGUAGE plpgsql;

-- ── 5. 简单索引（按模型聚合用量时用得上）─────────────────────────
CREATE INDEX IF NOT EXISTS logs_model_used_idx ON logs (model_used) WHERE model_used IS NOT NULL;
