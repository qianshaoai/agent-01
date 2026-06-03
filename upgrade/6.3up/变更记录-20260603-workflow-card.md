### 6.3up 变更记录 · 工作流卡片头部精简

日期：2026-06-03
分支：`feature/6.3up`
依据：[方案-工作流卡片头部精简-20260603.md](./方案-工作流卡片头部精简-20260603.md)
位置：`upgrade/6.3up/`（原 6.6up · 6/3 合并）

---

## 背景

用户截图反馈工作流卡片折叠态信息过密，希望把**分类标签 chip + 简介**从卡片头部挪到展开区，点折叠箭头才看到。

决策点收口（用户拍）：
- 决策 1 = **C** · 只移分类标签 + 简介（保留可见范围 + 停用 + 创建者 chip）
- 决策 2 = **a** · 简介展开后不 truncate（多行 wrap）
- 决策 3 = **a** · 智能体管理页不动（表格行非卡片结构）

---

## 实施

### Phase 1 · 折叠态头部精简 [app/admin/workflows/page.tsx](../../app/admin/workflows/page.tsx)

删两段（约 -18 行）：

1. **分类标签 chip 渲染**（原 line 778-789）：
   ```diff
   - {(wf.categoryIds ?? []).map((cid) => {
   -   const cat = categories.find((c) => c.id === cid);
   -   if (!cat) return null;
   -   return (
   -     <span ...>... {cat.name}</span>
   -   );
   - })}
   ```

2. **truncate 简介**（原 line 846）：
   ```diff
   - {wf.description && <p className="text-xs text-gray-400 mt-0.5 truncate">{wf.description}</p>}
   ```

**保留**：标题 + 可见范围 chip（org_only / personal_only / custom）+ 停用 chip + 创建者角色 chip + 步骤数 + 操作按钮。

### Phase 2 · 展开区下沉信息（约 +35 行）

[Line 870-885 区域](../../app/admin/workflows/page.tsx#L870-L885) 改造：

```tsx
<div className="flex items-start justify-between gap-3 mb-3">
  {/* Tab 切换（保持左对齐宽度）*/}
  <div className="... w-fit shrink-0">
    {(["list", "flow"] as const).map(...)}
  </div>

  {/* 6.3up · 分类 chip 行（右对齐 · flex-wrap）*/}
  {(wf.categoryIds ?? []).length > 0 && (
    <div className="flex items-center gap-2 flex-wrap justify-end min-w-0">
      {(wf.categoryIds ?? []).map((cid) => ...)}
    </div>
  )}
</div>

{/* 6.3up · 完整简介（不 truncate · whitespace-pre-wrap 保留换行）*/}
{wf.description && (
  <p className="text-sm text-gray-500 mb-3 leading-relaxed whitespace-pre-wrap">
    {wf.description}
  </p>
)}
```

**关键细节**：
- `justify-between` + Tab 切换 `shrink-0` + chip 区 `min-w-0 flex-wrap` —— chip 多了向左 wrap，不挤压 Tab
- 简介加 `whitespace-pre-wrap`，长描述里的换行能保留（之前 truncate 看不到）
- 简介加 `leading-relaxed`，多行可读性更好

### Phase 3 · CI

- `npm run ci:typecheck` ✓
- `npm run ci:lint` ✓（唯一 warning `app/agents/[id]/page.tsx:778` 与本期无关）

---

## 改动文件

| 类型 | 文件 | 行数 |
|---|---|---|
| 改 | `app/admin/workflows/page.tsx` | +35 / -18 |
| 新建 | `upgrade/6.3up/方案-工作流卡片头部精简-20260603.md` | （前置 commit）|
| 新建 | `upgrade/6.3up/变更记录-20260603-workflow-card.md` | （本文件）|

---

## 验收（6 项）

1. **折叠态**：卡片头部只显示「标题 + 可见范围 chip + 已停用 chip + 创建者 chip + 步骤数 + 操作按钮」
2. **折叠态**：分类标签 chip 不再出现
3. **折叠态**：简介不再显示
4. **展开后**：Tab 切换右侧出现分类标签 chip（带图标 + 名称）
5. **展开后**：完整简介显示在 chip 行下方，**不 truncate**，长描述能多行 wrap
6. 多分类工作流的标签 chip 全部展示，太多时向左 wrap 不挤压 Tab

---

## 下一步

1. 用户人工实测 6 项
2. 通过 → 与 6.2up + 6.3up（agent-builder）+ 知识库 + 标签管理合并 PR → master2
