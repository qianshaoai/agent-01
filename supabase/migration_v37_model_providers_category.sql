-- 5.15up · API 管理模块 PR-1 · model_providers 加 category 列
--
-- 把「模型接入」升级为「API 管理」模块，下分两类：
--   category = 'model' → 大模型 API（openai / zhipu …）
--   category = 'agent' → 智能体 API（coze / dify / yuanqi / qingyan）
-- UI 按 category 分两个 tab；后续 agents.provider_id 引用、智能体配置弹窗下拉
-- 都按 category 过滤可选项。
--
-- 幂等：列 / 约束 / 索引均 IF [NOT] EXISTS，可安全重跑。

-- 1) 加列（默认 model，存量行先全部落 model）
ALTER TABLE model_providers
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'model';

-- 2) 存量数据按 platform 归类：智能体平台改判为 agent
UPDATE model_providers
  SET category = 'agent'
  WHERE platform IN ('coze', 'dify', 'yuanqi', 'qingyan')
    AND category <> 'agent';

-- 3) 约束：category 只能是 model / agent
ALTER TABLE model_providers
  DROP CONSTRAINT IF EXISTS model_providers_category_check;
ALTER TABLE model_providers
  ADD CONSTRAINT model_providers_category_check
  CHECK (category IN ('model', 'agent'));

-- 4) 索引
--   (category, enabled)  —— 下拉只查某类启用项
CREATE INDEX IF NOT EXISTS model_providers_category_enabled_idx
  ON model_providers(category, enabled);
--   (category, platform) —— 按类型 + 平台筛选
CREATE INDEX IF NOT EXISTS model_providers_category_platform_idx
  ON model_providers(category, platform);
