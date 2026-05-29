-- 5.30.1 · 接入 Anthropic 原生协议 · 加 platform 'anthropic' + claude 系列权重种子
-- 来源：upgrade/5.30up/5.30.1/方案-anthropic-原生协议接入-20260529.md（R2 评审通过）
-- 改的表：model_providers.platform CHECK 约束扩 + model_quota_weights 种子加 3 条
-- 数据迁移：无（纯新增；现有行 platform 仍是 'openai'/'zhipu' 等不变）
--
-- 幂等：CHECK 约束 DROP + ADD；种子 ON CONFLICT DO NOTHING
--
-- 权重值依据：output 价格倍数对齐 5.7up "约 1/3 实际倍数" 口径
--   Haiku 4.5 实际 8.3x gpt-4o-mini → weight 3
--   Sonnet 4.6 实际 25x → weight 8（略高于 gpt-4o weight=5）
--   Opus 4.8 实际 41x → weight 15（对齐 o1-mini=15；2026-05-28 GA，与 4.7 同价）

ALTER TABLE model_providers DROP CONSTRAINT IF EXISTS model_providers_platform_check;
ALTER TABLE model_providers ADD CONSTRAINT model_providers_platform_check
  CHECK (platform IN ('openai','coze','dify','yuanqi','qingyan','zhipu','anthropic'));

INSERT INTO model_quota_weights (model_id, weight_per_call, enabled, note) VALUES
  ('claude-haiku-4-5-20251001',  3,  TRUE,  'Anthropic Haiku 4.5（轻量主力）'),
  ('claude-sonnet-4-6',          8,  TRUE,  'Anthropic Sonnet 4.6（平衡）'),
  ('claude-opus-4-8',            15, TRUE,  'Anthropic Opus 4.8（2026-05-28 GA · 最强）')
ON CONFLICT (model_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
