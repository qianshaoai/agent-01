### 6.3up 方案 · agent-builder 模型选择两级化

日期：2026-06-02
作者：小A
状态：用户直接拍板，沿用 `feature/6.2up-platform-input` 分支叠加，无需独立分支
位置：`upgrade/6.3up/`
依据：用户 2026-06-02 截图反馈 ——

> 「这个地方，不要直接选择模型了，把大模型厂家的功能加回来吧」

---

## A · 背景

5.29up 把「供应商 + 模型」合并成一个 grouped popover（[app/admin/agent-builder/[id]/page.tsx:882-961](../../app/admin/agent-builder/[id]/page.tsx#L882-L961)）：
admin 在「2. 模型设置」直接挑模型 → 自动联动 `provider_id` + `model_params.model`。
下方「当前供应商」小字让 admin 在 select 关闭后仍能看到当前用的是哪家。

**痛点**：
- 多 provider × 多 model 后下拉项过长
- 同模型名跨多 provider 时只能靠小字辨识
- 截图场景「claude（claude）」provider_code 与 platform 同名导致小字辨识度低
- admin 心智回不到「先选厂家，再选模型」的两级直觉

---

## B · 目标 + 不在范围

### 目标

1. **一级下拉「供应商 *」** → 选中后 set `provider_id` + reset `model_params.model`
2. **二级下拉「模型 *」** → 选中后 set `model_params.model`；未选供应商时 disabled
3. 数据契约不变：DB 仍存 `provider_id` + `model_params.model`，runtime 走原逻辑

### 不在范围（YAGNI）

- ✗ 自定义模型名输入框（5.29up 已删，第三方中转必误报，不恢复）
- ✗ buildModelOptions / composeValue / groupModelOptions（合并版 helpers，本期连带删除，避免 dead code）
- ✗ 数据契约任何改动（不动 DB / 路由）
- ✗ admin/agents API 配置弹窗（6.2up R1 范围，已落定）

---

## C · 4 决策点（已拍板）

| # | 决策 | 拍板 |
|---|---|---|
| 1 | up 编号 + 分支 | **B · 沿用 feature/6.2up-platform-input 分支叠加，不独立分支** |
| 2 | 切供应商后 model 字段 | **A · 自动 reset**（强制重选，避免静默错配，如 zhipu provider 留着 gpt-4o-mini）|
| 3 | 一级 select 形态 | **A · 复用 5.29up popover 风格**（新加 SimpleSelectPopover，单层无 group sticky）|
| 4 | 自定义模型名 | **A · 不恢复**（维持 5.29up 删除决定）|

---

## D · 设计

### D1 · 新 helpers

```ts
type Option = { value: string; label: string };

function buildProviderOptions(providers: Provider[]): Option[] {
  return providers
    .filter((p) => p.enabled && p.has_api_key)
    .map((p) => ({
      value: p.id,
      label: `${p.name}（${p.provider_code}）`,
    }));
}

function buildModelsForProvider(provider: Provider | undefined): Option[] {
  if (!provider) return [];
  const r = resolveProviderPresetForBuilder(provider);

  if (r.kind === "recognized" && r.preset.recommendedModels?.length) {
    return r.preset.recommendedModels.map((m) => ({
      value: m.value,
      label: stripModelDesc(m.label),
    }));
  }

  // openai / anthropic custom endpoint 兜底（同 5.29up + 5.30.1 口径）
  if (r.kind === "custom") {
    const all = getPresetsByCategory("model");
    if (provider.platform === "openai") {
      const list = all.find((p) => p.code === "openai-official")?.recommendedModels ?? [];
      return list.map((m) => ({ value: m.value, label: stripModelDesc(m.label) }));
    }
    if (provider.platform === "anthropic") {
      const list = all.find((p) => p.code === "anthropic-official")?.recommendedModels ?? [];
      return list.map((m) => ({ value: m.value, label: stripModelDesc(m.label) }));
    }
  }
  return [];
}
```

### D2 · SimpleSelectPopover

复用 `ModelSelectPopover` 的视觉/交互（按钮 + 浮层 + 点击外部关 + Esc 关 + 当前项高亮 ✓），改成接 `Option[]` 单层数据，去掉 group sticky 标题。

### D3 · UI 两级 select

```tsx
<Field label="供应商 *">
  <SimpleSelectPopover
    value={draft.provider_id ?? ""}
    options={buildProviderOptions(providers)}
    placeholder="请选择大模型供应商…"
    disabled={enabledProviders.length === 0}
    onChange={(v) => {
      // 切供应商时 reset model 字段（决策点 2 · A）
      patchDraft((d) => ({
        ...d,
        provider_id: v || null,
        model_params: { ...d.model_params, model: undefined },
      }));
    }}
  />
  {enabledProviders.length === 0 && (
    <p className="text-[11px] text-amber-600 mt-1">
      当前没有可用供应商。请先去 <Link href="/admin/model-providers">模型接入</Link> 添加并启用。
    </p>
  )}
</Field>

<Field label="模型 *">
  <SimpleSelectPopover
    value={(draft.model_params.model as string | undefined) ?? ""}
    options={buildModelsForProvider(selectedProvider)}
    placeholder={selectedProvider ? "请选择模型…" : "请先选供应商"}
    disabled={!selectedProvider}
    onChange={(v) => {
      patchDraft((d) => ({ ...d, model_params: { ...d.model_params, model: v || undefined } }));
    }}
  />
  {/* KB+flash 警告保留 */}
  {isKnowledgeBaseFlashModel && (
    <p className="text-[11px] text-amber-700 mt-1 leading-relaxed">
      已绑定知识库时不建议使用 GLM-4-Flash：验收中该模型会用常识反驳知识库事实。
      请改为 <code className="font-mono">glm-4-air</code> 或更高模型。
    </p>
  )}
</Field>
```

「当前供应商：xxx」小字删除（一级 select 已显式）。

### D4 · 删除连带 dead code

- `buildModelOptions`、`composeValue`、`groupModelOptions`、`GroupedOptions`、`ModelOption`：合并版专用，本期改两级后无引用 → 全删
- `ModelSelectPopover`：grouped 版本无引用 → 删（被 SimpleSelectPopover 取代）
- 顶部注释 5.29up「合并模型选择融合 helpers」段：更新成 6.3up「两级选择 helpers」描述

### D5 · 保留不动

- `Provider` / `Draft` / `ModelParams` 类型
- `resolveProviderPresetForBuilder` / `customProviderLabel` / `stripModelDesc`：仍被 buildModelsForProvider 复用
- `maybeSeedModelFromDefault`：老 draft model 缺失时兜默认值（chat route 真实运行时也走 provider.default_model）
- `validateModelBeforeSave`：发布校验逻辑无变化
- 所有 adapter / 路由 / DB

---

## E · 文件改动清单

| 状态 | 路径 |
|---|---|
| 改 | `app/admin/agent-builder/[id]/page.tsx`（删合并版 helpers + ModelSelectPopover；加 buildProviderOptions / buildModelsForProvider / SimpleSelectPopover；UI 改两级 + 删小字）|
| 新建 | `upgrade/6.3up/方案-agent-builder-模型选择两级化-20260602.md`（本文件）|
| 新建 | `upgrade/6.3up/变更记录-20260602.md`（实施后写）|

---

## F · 验收

**自动化**：
- `npm run ci:typecheck` 通过
- `npm run ci:lint` 通过（pre-existing warning 不变）

**人工 5 项**：

1. 进 agent-builder 搭建 chat 智能体 → 一级看到供应商列表 →「请选模型」disabled
2. 选某供应商 → 二级出现该 provider 的 recommendedModels → 选定 → DB / draft.model_params.model 写入
3. 切到另一供应商 → 二级列表换 + model 字段 reset 为空 → 不静默错配
4. 老 draft（已有 provider + model）打开 → 一级 / 二级正确回显
5. 没可用供应商 → 一级 disabled + amber 提示去模型接入

---

## G · 工程量

| Phase | 估时 |
|---|---|
| 方案文档（本次） | 30min |
| 删旧 helpers + 加新 helpers + popover | 1h |
| UI 两级改造 + 删小字 | 30min |
| typecheck / lint / 实测 | 30min |
| 变更记录 + commit | 30min |
| **总计** | **~3h（半天）** |

---

## H · 分支策略（已拍板）

沿用 `feature/6.2up-platform-input`，6.3up commits 叠在 6.2up 之上。最终 6.2up + 6.3up 一起 PR 到 master2。

---

## I · 下一步

1. 实施 D 节代码改动
2. typecheck + lint
3. 写变更记录
4. commit（按 docs / feat / docs 节奏）
5. 等用户人工 5 项实测
