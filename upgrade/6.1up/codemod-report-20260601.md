# 6.1up · Phase 0 · 响应式 codemod 扫描报告（2026-06-01）

> 由 [`scripts/responsive-codemod.mjs`](../../scripts/responsive-codemod.mjs) 自动产出。
> 扫 `app/` + `components/` 下 .tsx/.ts，按 R1.1 方案 D1 节 8 类规则识别。
> **不自动改文件**，本报告仅作改造依据。

---

## 总览

- 扫描文件数：**130**
- 命中文件数：**38**
- 命中条目数：**1082**
- 关键文件命中数：**10** / C4 名单 10 文件

## 按规则统计

| # | 规则 | 类别 | 命中数 | 主要改造方向 |
|---|---|---|---|---|
| 1 | 任意值宽高 | A | 96 | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 2 | 任意值内边距 | C | 0 | 改 var(--page-px) / var(--gap-card) token 或 Tailwind 预设 spacing |
| 3 | 任意值字号（慎改） | C | 351 | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 4 | 任意值圆角 | C | 578 | 改 var(--radius-sm) / var(--radius-lg) token |
| 5 | grid-cols 固定宽 | D | 1 | 加 responsive prefix（lg:grid-cols-[Xfr_Ypx]）或换 [Xfr_var(--side-panel-w)] |
| 6 | w-N / h-N 文字数字预设 | D | 35 | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 7 | max-w 大尺寸预设 | D | 19 | 改 max-w-[var(--content-max-w)] |
| 8 | 内联 style 含 px/calc | D | 2 | 逐 case 评估，可能要换 grid / flex / token |

## 按风险等级统计

- 低（可直接 apply）: **292**
- 中（关键页面 / 慎改字号）: **591**
- 高（layout / 架构讨论）: **199**

---

## 按文件分组（关键页面优先）

### `app/admin/agent-builder/[id]/page.tsx` 🔑 关键 · 39 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 342 | A | 中 | #1 任意值宽高 | `max-h-[220px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 343 | A | 中 | #1 任意值宽高 | `max-h-[220px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 349 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 935 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 945 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 953 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1128 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1192 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1211 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1232 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1281 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1392 | C | 高 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1396 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1414 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 333 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 343 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 795 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 816 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 827 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 865 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 874 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 975 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 988 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1010 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1031 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1040 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1084 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1159 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1172 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1238 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1248 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1254 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1278 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1316 | C | 中 | #4 任意值圆角 | `rounded-[14px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1332 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1342 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1373 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 852 | D | 高 | #5 grid-cols 固定宽 | `grid-cols-[1fr_400px]` | 加 responsive prefix（lg:grid-cols-[Xfr_Ypx]）或换 [Xfr_var(--side-panel-w)] |
| 1206 | D | 高 | #8 内联 style 含 px/calc | `style={{ height: "calc(100vh - 120px)" }}` | 逐 case 评估，可能要换 grid / flex / token |

### `app/admin/agents/page.tsx` 🔑 关键 · 88 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 625 | A | 中 | #1 任意值宽高 | `max-w-[180px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 652 | A | 中 | #1 任意值宽高 | `min-w-[240px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 652 | A | 中 | #1 任意值宽高 | `max-w-[360px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 654 | A | 中 | #1 任意值宽高 | `max-h-[280px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1152 | A | 中 | #1 任意值宽高 | `max-h-[260px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 496 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 502 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 532 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 536 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 548 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 563 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 564 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 585 | C | 高 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 592 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 615 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 625 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 640 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 653 | C | 高 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 663 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 893 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1168 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1169 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 499 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 502 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 517 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 522 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 526 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 540 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 559 | C | 中 | #4 任意值圆角 | `rounded-[3px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 580 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 595 | C | 中 | #4 任意值圆角 | `rounded-[3px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 652 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 663 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 684 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 690 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 693 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 695 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 696 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 697 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 716 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 736 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 742 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 750 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 751 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 757 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 763 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 770 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 775 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 779 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 780 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 794 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 799 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 806 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 824 | C | 中 | #4 任意值圆角 | `rounded-[4px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 854 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 856 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 866 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 874 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 898 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 908 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 933 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 939 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 954 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 962 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 971 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 986 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 994 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 996 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1002 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1021 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1032 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1039 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1047 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1054 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1061 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1068 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1072 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1086 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1097 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1113 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1115 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1129 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1141 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1143 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1152 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1161 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 937 | D | 高 | #6 w-N / h-N 文字数字预设 | `h-72` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 1095 | D | 高 | #6 w-N / h-N 文字数字预设 | `h-64` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |

### `app/admin/knowledge-bases/[id]/page.tsx` 🔑 关键 · 41 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 297 | A | 中 | #1 任意值宽高 | `w-[480px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 297 | A | 中 | #1 任意值宽高 | `h-[480px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 298 | A | 中 | #1 任意值宽高 | `w-[420px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 298 | A | 中 | #1 任意值宽高 | `h-[420px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 299 | A | 中 | #1 任意值宽高 | `w-[360px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 299 | A | 中 | #1 任意值宽高 | `h-[360px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 301 | A | 中 | #1 任意值宽高 | `max-w-[1400px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 603 | A | 中 | #1 任意值宽高 | `max-w-[120px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 373 | C | 高 | #3 任意值字号（慎改） | `text-[18px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 379 | C | 高 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 384 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 445 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 468 | C | 高 | #3 任意值字号（慎改） | `text-[18px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 469 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 530 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 589 | C | 高 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 596 | C | 高 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 603 | C | 高 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 304 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 310 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 316 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 323 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 327 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 333 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 339 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 346 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 354 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 360 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 368 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 398 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 405 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 420 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 431 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 462 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 464 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 487 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 496 | C | 中 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 509 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 545 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 554 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 301 | D | 高 | #7 max-w 大尺寸预设 | `max-w-[1400px]` | 改 max-w-[var(--content-max-w)] |

### `app/admin/knowledge-bases/page.tsx` 🔑 关键 · 38 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 101 | A | 中 | #1 任意值宽高 | `w-[480px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 101 | A | 中 | #1 任意值宽高 | `h-[480px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 102 | A | 中 | #1 任意值宽高 | `w-[420px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 102 | A | 中 | #1 任意值宽高 | `h-[420px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 103 | A | 中 | #1 任意值宽高 | `w-[360px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 103 | A | 中 | #1 任意值宽高 | `h-[360px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 105 | A | 中 | #1 任意值宽高 | `max-w-[1400px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 220 | A | 中 | #1 任意值宽高 | `w-[420px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 285 | A | 中 | #1 任意值宽高 | `max-w-[120px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 113 | C | 高 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 114 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 116 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 181 | C | 高 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 189 | C | 高 | #3 任意值字号（慎改） | `text-[16px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 192 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 198 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 201 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 271 | C | 高 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 278 | C | 高 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 285 | C | 高 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 125 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 132 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 143 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 145 | C | 中 | #4 任意值圆角 | `rounded-[14px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 152 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 153 | C | 中 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 165 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 174 | C | 中 | #4 任意值圆角 | `rounded-[14px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 220 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 228 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 236 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 242 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 249 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 168 | D | 高 | #6 w-N / h-N 文字数字预设 | `w-56` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 168 | D | 高 | #6 w-N / h-N 文字数字预设 | `h-56` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 169 | D | 高 | #6 w-N / h-N 文字数字预设 | `w-48` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 169 | D | 高 | #6 w-N / h-N 文字数字预设 | `h-48` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 105 | D | 高 | #7 max-w 大尺寸预设 | `max-w-[1400px]` | 改 max-w-[var(--content-max-w)] |

### `app/admin/model-providers/page.tsx` 🔑 关键 · 22 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 485 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 489 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 494 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 523 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 644 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 704 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 729 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 758 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 779 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 781 | C | 高 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 437 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 620 | C | 中 | #4 任意值圆角 | `rounded-[14px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 642 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 653 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 694 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 722 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 742 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 755 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 777 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 792 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 810 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 400 | D | 高 | #7 max-w 大尺寸预设 | `max-w-6xl` | 改 max-w-[var(--content-max-w)] |

### `app/admin/users/page.tsx` 🔑 关键 · 119 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 598 | A | 中 | #1 任意值宽高 | `min-w-[220px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 622 | A | 中 | #1 任意值宽高 | `min-w-[280px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1192 | A | 中 | #1 任意值宽高 | `max-w-[480px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1258 | A | 中 | #1 任意值宽高 | `max-w-[560px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1460 | A | 中 | #1 任意值宽高 | `max-h-[400px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 575 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 580 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 586 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 655 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 713 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 714 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 715 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 716 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 717 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 718 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 719 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 720 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 760 | C | 高 | #3 任意值字号（慎改） | `text-[14px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 772 | C | 高 | #3 任意值字号（慎改） | `text-[14px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 775 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 778 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 784 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 791 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 799 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 802 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 803 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 808 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 812 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 874 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 876 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 884 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 885 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 890 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1219 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1225 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1266 | C | 高 | #3 任意值字号（慎改） | `text-[18px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1267 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1281 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1312 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1322 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1337 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1352 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 66 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 578 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 580 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 586 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 664 | C | 中 | #4 任意值圆角 | `rounded-[14px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 669 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 676 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 685 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 821 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 828 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 836 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 845 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 853 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 876 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 884 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 885 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 890 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 908 | C | 中 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 911 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 927 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 933 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 939 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 947 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 955 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 956 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 966 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 967 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 980 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 985 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 989 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1001 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1022 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1032 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1051 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1054 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1062 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1069 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1077 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1078 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1092 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1095 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1105 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1120 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1125 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1126 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1137 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1140 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1150 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1164 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1179 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1180 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1192 | C | 中 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1197 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1202 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1212 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1225 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1237 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1240 | C | 中 | #4 任意值圆角 | `rounded-b-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1241 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1245 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1262 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1274 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1343 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1346 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1350 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1366 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1374 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1379 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1400 | C | 中 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1405 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1421 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1430 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1439 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1444 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1458 | C | 中 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1487 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 989 | D | 高 | #6 w-N / h-N 文字数字预设 | `h-48` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |

### `app/admin/workflows/page.tsx` 🔑 关键 · 108 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 734 | A | 中 | #1 任意值宽高 | `min-w-[220px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1041 | A | 中 | #1 任意值宽高 | `max-w-[260px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1615 | A | 中 | #1 任意值宽高 | `w-[240px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1863 | A | 中 | #1 任意值宽高 | `max-w-[440px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1872 | A | 中 | #1 任意值宽高 | `max-w-[280px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1903 | A | 中 | #1 任意值宽高 | `max-h-[400px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 715 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 720 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 757 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 808 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 820 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 821 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1328 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1329 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1402 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1403 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1409 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1624 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1627 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1633 | C | 高 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1647 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1652 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1662 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1667 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1686 | C | 高 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1814 | C | 高 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1869 | C | 高 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1871 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1897 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1907 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1938 | C | 高 | #3 任意值字号（慎改） | `text-[14px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1941 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1944 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1948 | C | 高 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1961 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1964 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 718 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 720 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 736 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 738 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 742 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 751 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 764 | C | 中 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 816 | C | 中 | #4 任意值圆角 | `rounded-[3px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 837 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 850 | C | 中 | #4 任意值圆角 | `rounded-[3px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 920 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 924 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 925 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 926 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 936 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 941 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 994 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1053 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1054 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1055 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1058 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1059 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1075 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1099 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1121 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1127 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1135 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1136 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1142 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1148 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1155 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1160 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1162 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1163 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1178 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1184 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1192 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1222 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1258 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1263 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1299 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1304 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1363 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1368 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1447 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1460 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1467 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1472 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1476 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1480 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1484 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1494 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1508 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1521 | C | 中 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1569 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1573 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1615 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1715 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1724 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1733 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1742 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1751 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1775 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1863 | C | 中 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1878 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1894 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1919 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1927 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1964 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1304 | D | 高 | #6 w-N / h-N 文字数字预设 | `h-60` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 1368 | D | 高 | #6 w-N / h-N 文字数字预设 | `h-72` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 1619 | D | 高 | #8 内联 style 含 px/calc | `style={{ minHeight: "150px" }}` | 逐 case 评估，可能要换 grid / flex / token |

### `app/agents/[id]/page.tsx` 🔑 关键 · 93 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 197 | A | 中 | #1 任意值宽高 | `max-w-[220px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 197 | A | 中 | #1 任意值宽高 | `max-h-[200px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 212 | A | 中 | #1 任意值宽高 | `max-w-[140px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 229 | A | 中 | #1 任意值宽高 | `w-[2px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 229 | A | 中 | #1 任意值宽高 | `h-[14px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 243 | A | 中 | #1 任意值宽高 | `min-w-[360px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1794 | A | 中 | #1 任意值宽高 | `w-[180px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1794 | A | 中 | #1 任意值宽高 | `max-w-[240px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1973 | A | 中 | #1 任意值宽高 | `w-[88px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 2172 | A | 中 | #1 任意值宽高 | `max-w-[120px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 2269 | A | 中 | #1 任意值宽高 | `w-[440px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 2303 | A | 中 | #1 任意值宽高 | `w-[400px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 2331 | A | 中 | #1 任意值宽高 | `w-[460px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 99 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 112 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 121 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 178 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 208 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 256 | C | 高 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 261 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 267 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 279 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 296 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 314 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 324 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 330 | C | 高 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1803 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1812 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1858 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1880 | C | 高 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1968 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1978 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 2001 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 2011 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 2031 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 2130 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 2139 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 2253 | C | 高 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 2307 | C | 高 | #3 任意值字号（慎改） | `text-[18px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 2337 | C | 高 | #3 任意值字号（慎改） | `text-[16px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 2342 | C | 高 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 2344 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 32 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 110 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 174 | C | 中 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 174 | C | 中 | #4 任意值圆角 | `rounded-tr-[4px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 174 | C | 中 | #4 任意值圆角 | `rounded-tl-[4px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 191 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 208 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 256 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 261 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 267 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 296 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 314 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 324 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1688 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1692 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1699 | C | 中 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1713 | C | 中 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1727 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1730 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1734 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1771 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1794 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1822 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1839 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1843 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1851 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1870 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1884 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1904 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1920 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1930 | C | 中 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2047 | C | 中 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2053 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2108 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2165 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2194 | C | 中 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2215 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2221 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2229 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2238 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2269 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2283 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2289 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2303 | C | 中 | #4 任意值圆角 | `rounded-[24px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2331 | C | 中 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2333 | C | 中 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2341 | C | 中 | #4 任意值圆角 | `rounded-[14px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2353 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2363 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1834 | D | 高 | #6 w-N / h-N 文字数字预设 | `w-64` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 2136 | D | 高 | #7 max-w 大尺寸预设 | `max-w-4xl` | 改 max-w-[var(--content-max-w)] |

### `components/layout/admin-layout.tsx` 🔑 关键 · 18 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 256 | A | 中 | #1 任意值宽高 | `max-w-[1600px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 160 | C | 高 | #3 任意值字号（慎改） | `text-[14px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 164 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 171 | C | 高 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 172 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 173 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 181 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 191 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 211 | C | 高 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 263 | C | 高 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 150 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 170 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 191 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 211 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 244 | C | 中 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 223 | D | 高 | #6 w-N / h-N 文字数字预设 | `w-60` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 231 | D | 高 | #6 w-N / h-N 文字数字预设 | `w-60` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 256 | D | 高 | #7 max-w 大尺寸预设 | `max-w-[1600px]` | 改 max-w-[var(--content-max-w)] |

### `components/ui/page-header.tsx` 🔑 关键 · 1 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 18 | C | 中 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |

### `app/admin/agent-builder/page.tsx` · 1 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 122 | D | 高 | #7 max-w 大尺寸预设 | `max-w-6xl` | 改 max-w-[var(--content-max-w)] |

### `app/admin/analytics/page.tsx` · 39 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 208 | A | 低 | #1 任意值宽高 | `min-w-[220px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 119 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 124 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 130 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 141 | C | 中 | #3 任意值字号（慎改） | `text-[26px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 142 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 150 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 162 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 164 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 175 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 187 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 188 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 192 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 193 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 230 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 239 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 242 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 248 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 249 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 250 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 251 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 252 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 253 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 254 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 275 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 277 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 279 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 281 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 287 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 290 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 117 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 119 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 124 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 130 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 140 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 211 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 217 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 221 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 225 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |

### `app/admin/audit-logs/page.tsx` · 6 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 143 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 166 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 183 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 193 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 279 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 286 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |

### `app/admin/dashboard/page.tsx` · 12 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 72 | C | 中 | #3 任意值字号（慎改） | `text-[26px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 74 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 88 | C | 中 | #3 任意值字号（慎改） | `text-[22px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 89 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 93 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 94 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 102 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 117 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 124 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 66 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 84 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 105 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |

### `app/admin/logs/page.tsx` · 32 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 100 | A | 低 | #1 任意值宽高 | `min-w-[220px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 156 | A | 低 | #1 任意值宽高 | `max-w-[140px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 90 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 92 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 130 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 139 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 142 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 143 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 146 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 147 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 150 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 154 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 156 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 156 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 160 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 160 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 164 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 165 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 168 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 168 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 180 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 181 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 186 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 187 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 92 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 102 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 104 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 109 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 113 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 181 | C | 低 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 186 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 187 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |

### `app/admin/notices/page.tsx` · 11 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 115 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 100 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 109 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 127 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 128 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 129 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 142 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 147 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 167 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 177 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 91 | D | 高 | #7 max-w 大尺寸预设 | `max-w-4xl` | 改 max-w-[var(--content-max-w)] |

### `app/admin/page.tsx` · 20 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 132 | A | 低 | #1 任意值宽高 | `max-w-[420px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 121 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 213 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 217 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 113 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 133 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 163 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 178 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 194 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 202 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 213 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 228 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 242 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 250 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 258 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 135 | D | 中 | #6 w-N / h-N 文字数字预设 | `w-56` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 135 | D | 中 | #6 w-N / h-N 文字数字预设 | `h-56` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 136 | D | 中 | #6 w-N / h-N 文字数字预设 | `w-48` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 136 | D | 中 | #6 w-N / h-N 文字数字预设 | `h-48` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 111 | D | 高 | #7 max-w 大尺寸预设 | `max-w-6xl` | 改 max-w-[var(--content-max-w)] |

### `app/admin/settings/page.tsx` · 12 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 189 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 253 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 275 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 320 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 403 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 181 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 198 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 262 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 286 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 333 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 368 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 419 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |

### `app/admin/tenants/page.tsx` · 19 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 271 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 280 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 288 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 306 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 309 | C | 低 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 326 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 327 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 328 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 343 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 364 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 374 | C | 低 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 409 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 414 | C | 低 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 438 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 454 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 468 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 484 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 500 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 508 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |

### `app/error.tsx` · 1 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 19 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |

### `app/login/page.tsx` · 16 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 122 | A | 低 | #1 任意值宽高 | `max-w-[960px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 98 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 90 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 123 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 164 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 179 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 195 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 201 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 237 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 248 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 143 | D | 中 | #6 w-N / h-N 文字数字预设 | `w-56` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 143 | D | 中 | #6 w-N / h-N 文字数字预设 | `h-56` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 144 | D | 中 | #6 w-N / h-N 文字数字预设 | `w-48` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 144 | D | 中 | #6 w-N / h-N 文字数字预设 | `h-48` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 237 | D | 中 | #6 w-N / h-N 文字数字预设 | `w-72` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 88 | D | 高 | #7 max-w 大尺寸预设 | `max-w-6xl` | 改 max-w-[var(--content-max-w)] |

### `app/not-found.tsx` · 1 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 8 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |

### `app/page.tsx` · 97 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 438 | A | 低 | #1 任意值宽高 | `w-[600px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 438 | A | 低 | #1 任意值宽高 | `h-[600px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 439 | A | 低 | #1 任意值宽高 | `w-[640px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 439 | A | 低 | #1 任意值宽高 | `h-[640px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 440 | A | 低 | #1 任意值宽高 | `w-[420px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 440 | A | 低 | #1 任意值宽高 | `h-[420px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 443 | A | 低 | #1 任意值宽高 | `max-w-[1600px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 548 | A | 低 | #1 任意值宽高 | `w-[160px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 634 | A | 低 | #1 任意值宽高 | `max-w-[1600px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1082 | A | 低 | #1 任意值宽高 | `max-w-[1600px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1149 | A | 低 | #1 任意值宽高 | `w-[420px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1192 | A | 低 | #1 任意值宽高 | `w-[420px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 476 | C | 中 | #3 任意值字号（慎改） | `text-[18px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 487 | C | 中 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 492 | C | 中 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 497 | C | 中 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 550 | C | 中 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 653 | C | 中 | #3 任意值字号（慎改） | `text-[14px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 671 | C | 中 | #3 任意值字号（慎改） | `text-[14px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 744 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 745 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 753 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 783 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 801 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 802 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 809 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 864 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 865 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 888 | C | 中 | #3 任意值字号（慎改） | `text-[16px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 892 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 899 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 902 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 920 | C | 中 | #3 任意值字号（慎改） | `text-[18px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 924 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 957 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 967 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 972 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 976 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1013 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1030 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1034 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1038 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1061 | C | 中 | #3 任意值字号（慎改） | `text-[18px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1062 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1093 | C | 中 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 446 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 452 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 501 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 519 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 532 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 548 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 585 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 594 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 606 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 615 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 623 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 653 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 671 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 706 | C | 低 | #4 任意值圆角 | `rounded-[14px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 721 | C | 低 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 783 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 798 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 842 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 844 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 851 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 852 | C | 低 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 873 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 882 | C | 低 | #4 任意值圆角 | `rounded-[14px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 914 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 916 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 931 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 938 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1030 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1034 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1038 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1055 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1057 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1111 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1115 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1149 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1161 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1167 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1174 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1192 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1207 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1213 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1220 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 637 | D | 中 | #6 w-N / h-N 文字数字预设 | `w-60` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 637 | D | 中 | #6 w-N / h-N 文字数字预设 | `w-56` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 876 | D | 中 | #6 w-N / h-N 文字数字预设 | `w-56` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 876 | D | 中 | #6 w-N / h-N 文字数字预设 | `h-56` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 877 | D | 中 | #6 w-N / h-N 文字数字预设 | `w-48` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 877 | D | 中 | #6 w-N / h-N 文字数字预设 | `h-48` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 1111 | D | 中 | #6 w-N / h-N 文字数字预设 | `w-72` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 443 | D | 高 | #7 max-w 大尺寸预设 | `max-w-[1600px]` | 改 max-w-[var(--content-max-w)] |
| 634 | D | 高 | #7 max-w 大尺寸预设 | `max-w-[1600px]` | 改 max-w-[var(--content-max-w)] |
| 1082 | D | 高 | #7 max-w 大尺寸预设 | `max-w-[1600px]` | 改 max-w-[var(--content-max-w)] |

### `app/register/page.tsx` · 11 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 129 | A | 低 | #1 任意值宽高 | `max-w-[460px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 113 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 11 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 105 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 130 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 143 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 147 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 158 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 280 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 286 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 103 | D | 高 | #7 max-w 大尺寸预设 | `max-w-6xl` | 改 max-w-[var(--content-max-w)] |

### `app/settings/page.tsx` · 28 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 26 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 139 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 149 | C | 低 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 154 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 158 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 162 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 169 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 178 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 184 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 198 | C | 低 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 204 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 213 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 227 | C | 低 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 232 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 236 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 240 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 265 | C | 低 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 272 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 283 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 297 | C | 低 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 302 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 322 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 324 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 332 | C | 低 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 342 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 351 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 360 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 367 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |

### `app/trial/page.tsx` · 106 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 1112 | A | 低 | #1 任意值宽高 | `w-[600px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1112 | A | 低 | #1 任意值宽高 | `h-[600px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1113 | A | 低 | #1 任意值宽高 | `w-[640px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1113 | A | 低 | #1 任意值宽高 | `h-[640px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1114 | A | 低 | #1 任意值宽高 | `w-[420px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1114 | A | 低 | #1 任意值宽高 | `h-[420px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1145 | A | 低 | #1 任意值宽高 | `max-w-[1480px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1197 | A | 低 | #1 任意值宽高 | `max-w-[1480px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1232 | A | 低 | #1 任意值宽高 | `w-[3px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1256 | A | 低 | #1 任意值宽高 | `w-[3px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1412 | A | 低 | #1 任意值宽高 | `w-[280px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1685 | A | 低 | #1 任意值宽高 | `max-w-[520px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1736 | A | 低 | #1 任意值宽高 | `max-w-[220px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1736 | A | 低 | #1 任意值宽高 | `max-h-[200px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1784 | A | 低 | #1 任意值宽高 | `max-w-[140px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1824 | A | 低 | #1 任意值宽高 | `w-[2px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1824 | A | 低 | #1 任意值宽高 | `h-[14px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1829 | A | 低 | #1 任意值宽高 | `min-w-[260px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1991 | A | 低 | #1 任意值宽高 | `max-w-[140px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 1175 | C | 中 | #3 任意值字号（慎改） | `text-[18px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1182 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1224 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1240 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1248 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1264 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1371 | C | 中 | #3 任意值字号（慎改） | `text-[16px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1374 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1380 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1383 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1442 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1485 | C | 中 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1538 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1542 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1551 | C | 中 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1627 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1655 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1658 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1694 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1710 | C | 中 | #3 任意值字号（慎改） | `text-[14px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1742 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1841 | C | 中 | #3 任意值字号（慎改） | `text-[14px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1846 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1856 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1870 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1881 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1892 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1907 | C | 中 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1920 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1935 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1973 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1993 | C | 中 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 1138 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1156 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1182 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1187 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1199 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1224 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1248 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1308 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1310 | C | 低 | #4 任意值圆角 | `rounded-[14px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1318 | C | 低 | #4 任意值圆角 | `rounded-[18px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1330 | C | 低 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1347 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1356 | C | 低 | #4 任意值圆角 | `rounded-[14px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1362 | C | 低 | #4 任意值圆角 | `rounded-[14px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1409 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1420 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1427 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1442 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1496 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1538 | C | 低 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1563 | C | 低 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1573 | C | 低 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1594 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1626 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1627 | C | 低 | #4 任意值圆角 | `rounded-[14px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1636 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1642 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1648 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1675 | C | 低 | #4 任意值圆角 | `rounded-[18px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1712 | C | 低 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1712 | C | 低 | #4 任意值圆角 | `rounded-tr-[4px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1713 | C | 低 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1713 | C | 低 | #4 任意值圆角 | `rounded-tl-[4px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1729 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1742 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1841 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1846 | C | 低 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1856 | C | 低 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1892 | C | 低 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1920 | C | 低 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1935 | C | 低 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1973 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1984 | C | 低 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1987 | C | 低 | #4 任意值圆角 | `rounded-[6px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2026 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2055 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2061 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 2073 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 1350 | D | 中 | #6 w-N / h-N 文字数字预设 | `w-56` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 1350 | D | 中 | #6 w-N / h-N 文字数字预设 | `h-56` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 1351 | D | 中 | #6 w-N / h-N 文字数字预设 | `w-48` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 1351 | D | 中 | #6 w-N / h-N 文字数字预设 | `h-48` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 1409 | D | 中 | #6 w-N / h-N 文字数字预设 | `w-64` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |
| 1145 | D | 高 | #7 max-w 大尺寸预设 | `max-w-[1480px]` | 改 max-w-[var(--content-max-w)] |
| 1197 | D | 高 | #7 max-w 大尺寸预设 | `max-w-[1480px]` | 改 max-w-[var(--content-max-w)] |

### `app/user-agents/[id]/page.tsx` · 11 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 208 | A | 低 | #1 任意值宽高 | `min-h-[42px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 208 | A | 低 | #1 任意值宽高 | `max-h-[120px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 142 | C | 中 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 130 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 133 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 150 | C | 低 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 165 | C | 低 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 167 | C | 低 | #4 任意值圆角 | `rounded-br-[4px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 168 | C | 低 | #4 任意值圆角 | `rounded-bl-[4px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 208 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 213 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |

### `app/workflows/history/[id]/page.tsx` · 25 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 116 | A | 低 | #1 任意值宽高 | `max-w-[1200px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 137 | A | 低 | #1 任意值宽高 | `max-w-[1200px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 127 | C | 中 | #3 任意值字号（慎改） | `text-[16px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 129 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 146 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 153 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 156 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 169 | C | 中 | #3 任意值字号（慎改） | `text-[14px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 170 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 185 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 189 | C | 中 | #3 任意值字号（慎改） | `text-[14px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 192 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 196 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 201 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 205 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 211 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 239 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 119 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 144 | C | 低 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 152 | C | 低 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 167 | C | 低 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 201 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 205 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 116 | D | 高 | #7 max-w 大尺寸预设 | `max-w-[1200px]` | 改 max-w-[var(--content-max-w)] |
| 137 | D | 高 | #7 max-w 大尺寸预设 | `max-w-[1200px]` | 改 max-w-[var(--content-max-w)] |

### `app/workflows/history/page.tsx` · 16 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 108 | A | 低 | #1 任意值宽高 | `max-w-[1200px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 126 | A | 低 | #1 任意值宽高 | `max-w-[1200px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 129 | A | 低 | #1 任意值宽高 | `min-w-[220px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 120 | C | 中 | #3 任意值字号（慎改） | `text-[16px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 144 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 183 | C | 中 | #3 任意值字号（慎改） | `text-[14px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 184 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 188 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 203 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 211 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 112 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 127 | C | 低 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 136 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 157 | C | 低 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 108 | D | 高 | #7 max-w 大尺寸预设 | `max-w-[1200px]` | 改 max-w-[var(--content-max-w)] |
| 126 | D | 高 | #7 max-w 大尺寸预设 | `max-w-[1200px]` | 改 max-w-[var(--content-max-w)] |

### `components/admin/scope-filter.tsx` · 8 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 247 | A | 低 | #1 任意值宽高 | `max-h-[320px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 284 | A | 低 | #1 任意值宽高 | `max-h-[320px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 326 | A | 低 | #1 任意值宽高 | `max-h-[320px]` | 改 responsive prefix 或 var(--sidebar-w) 等容器 token |
| 224 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 247 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 284 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 326 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 247 | D | 中 | #6 w-N / h-N 文字数字预设 | `w-64` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |

### `components/agent-card.tsx` · 8 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 25 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 28 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 29 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 35 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 46 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 15 | C | 低 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 20 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 38 | C | 低 | #4 任意值圆角 | `rounded-[3px]` | 改 var(--radius-sm) / var(--radius-lg) token |

### `components/quota-popover.tsx` · 16 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 104 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 127 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 175 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 176 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 186 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 194 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 195 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 206 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 227 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 229 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 235 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 253 | C | 中 | #3 任意值字号（慎改） | `text-[11px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 265 | C | 中 | #3 任意值字号（慎改） | `text-[12px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 266 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 101 | C | 低 | #4 任意值圆角 | `rounded-[14px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 101 | D | 中 | #6 w-N / h-N 文字数字预设 | `w-72` | 若用于侧栏 / 容器宽度，改 var(--sidebar-w) 或加 responsive prefix；图标固定尺寸保留 |

### `components/ui/button.tsx` · 4 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 30 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 31 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 33 | C | 中 | #3 任意值字号（慎改） | `text-[15px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 14 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |

### `components/ui/first-login-modal.tsx` · 3 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 35 | C | 低 | #4 任意值圆角 | `rounded-[20px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 47 | C | 低 | #4 任意值圆角 | `rounded-[14px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 57 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |

### `components/ui/input.tsx` · 2 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 18 | C | 中 | #3 任意值字号（慎改） | `text-[13px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 29 | C | 低 | #4 任意值圆角 | `rounded-[10px]` | 改 var(--radius-sm) / var(--radius-lg) token |

### `components/ui/toast.tsx` · 1 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 65 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |

### `components/user-agent-card.tsx` · 4 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 19 | C | 中 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 26 | C | 中 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 9 | C | 低 | #4 任意值圆角 | `rounded-[16px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 14 | C | 低 | #4 任意值圆角 | `rounded-[12px]` | 改 var(--radius-sm) / var(--radius-lg) token |

### `components/workflow-step-button.tsx` · 5 条命中

| 行 | 类别 | 风险 | 规则 | 匹配 | 改造方向 |
|---|---|---|---|---|---|
| 59 | C | 中 | #3 任意值字号（慎改） | `text-[10px]` | 已被 globals.css 5.7up/5.9up 字号缩放体系覆盖，慎改 / 通常保留 |
| 25 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 40 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 58 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
| 70 | C | 低 | #4 任意值圆角 | `rounded-[8px]` | 改 var(--radius-sm) / var(--radius-lg) token |
