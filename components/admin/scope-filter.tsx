"use client";

// 5.12up · 用户列表筛选 · 三级级联组织/部门/小组下拉
// 使用约定（用户决策）：
//   决策 1=A：点击节点名直接筛选 + 关闭下拉
//   决策 2=B：点击节点右侧 > 才展开下一级（不用 hover）
//   决策 3=A：按钮显示完整路径"组织 / 部门 / 小组"
//   决策 4：支持键盘 ↑↓ 切级别 → 展开 ← 收起 Enter 选择 Esc 关闭

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ChevronDown, X } from "lucide-react";

export type Tenant = { id: string; code: string; name: string };
export type Dept = { id: string; name: string; tenant_code: string };
export type Team = { id: string; name: string; dept_id: string };

export type ScopeValue = {
  tenantCode?: string;
  deptId?: string;
  teamId?: string;
};

type Level = 0 | 1 | 2; // 0 = 一级菜单（组织）, 1 = 二级（部门）, 2 = 三级（小组）

export function ScopeFilter({
  tenants,
  depts,
  teams,
  value,
  onChange,
  className = "",
  buttonClassName = "",
}: {
  tenants: Tenant[];
  depts: Dept[];
  teams: Team[];
  value: ScopeValue;
  onChange: (v: ScopeValue) => void;
  className?: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [openLevel, setOpenLevel] = useState<Level>(0);
  // 展开但未选定时记录"当前展开了哪个组织/部门"
  const [expandedTenant, setExpandedTenant] = useState<string | null>(null);
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  // 键盘高亮（每级独立）
  const [hl0, setHl0] = useState(0);
  const [hl1, setHl1] = useState(0);
  const [hl2, setHl2] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  // 5.12up · 三级菜单全展开 ≈ 580px，靠右边屏会溢出 → 检测后向左对齐
  const [alignRight, setAlignRight] = useState(false);

  // 当前展开的部门列表
  const deptsOfExpanded = useMemo(
    () => (expandedTenant ? depts.filter((d) => d.tenant_code === expandedTenant) : []),
    [depts, expandedTenant],
  );
  // 当前展开的小组列表
  const teamsOfExpanded = useMemo(
    () => (expandedDept ? teams.filter((t) => t.dept_id === expandedDept) : []),
    [teams, expandedDept],
  );

  // 显示路径
  const labelText = useMemo(() => {
    if (!value.tenantCode) return "全部组织";
    const t = tenants.find((x) => x.code === value.tenantCode);
    const tName = t?.name ?? value.tenantCode;
    if (!value.deptId) return tName;
    const d = depts.find((x) => x.id === value.deptId);
    const dName = d?.name ?? "?";
    if (!value.teamId) return `${tName} / ${dName}`;
    const tm = teams.find((x) => x.id === value.teamId);
    const tmName = tm?.name ?? "?";
    return `${tName} / ${dName} / ${tmName}`;
  }, [value, tenants, depts, teams]);

  // 打开时根据当前 value 预展开内部 UI 状态（把外部 prop 镜像到 internal state，合法用例）
  // React 18+ 自动批处理同一 effect 内的多次 setState，cascading-renders 规则在这里偏严
  useEffect(() => {
    if (open) {
      /* eslint-disable react-hooks/set-state-in-effect */
      if (value.tenantCode) {
        setExpandedTenant(value.tenantCode);
        if (value.deptId) {
          setExpandedDept(value.deptId);
          setOpenLevel(2);
        } else {
          setExpandedDept(null);
          setOpenLevel(1);
        }
      } else {
        setExpandedTenant(null);
        setExpandedDept(null);
        setOpenLevel(0);
      }
      setHl0(0);
      setHl1(0);
      setHl2(0);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open, value.tenantCode, value.deptId]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // 打开时检测溢出方向
  useEffect(() => {
    if (!open || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    // 三级全展开宽度 = 256 + 176 + 144 + 8(gap) ≈ 584px
    const MENU_WIDTH = 584;
    const overflowRight = rect.left + MENU_WIDTH > window.innerWidth;
    setAlignRight(overflowRight);
  }, [open]);

  // 选定 + 关闭
  function pick(next: ScopeValue) {
    onChange(next);
    setOpen(false);
  }

  // 展开下一级
  function expandTenant(code: string) {
    setExpandedTenant(code);
    setExpandedDept(null);
    setOpenLevel(1);
    setHl1(0);
  }
  function expandDept(id: string) {
    setExpandedDept(id);
    setOpenLevel(2);
    setHl2(0);
  }

  // 键盘
  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (openLevel === 0) {
      // 一级菜单含一行"全部组织"占位 + tenants
      const total = tenants.length + 1;
      if (e.key === "ArrowDown") { e.preventDefault(); setHl0((i) => (i + 1) % total); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setHl0((i) => (i - 1 + total) % total); return; }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (hl0 > 0) {
          const t = tenants[hl0 - 1];
          if (t) expandTenant(t.code);
        }
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (hl0 === 0) pick({});
        else {
          const t = tenants[hl0 - 1];
          if (t) pick({ tenantCode: t.code });
        }
        return;
      }
    } else if (openLevel === 1) {
      const total = deptsOfExpanded.length + 1; // "全部部门" + 各部门
      if (e.key === "ArrowDown") { e.preventDefault(); setHl1((i) => (i + 1) % total); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setHl1((i) => (i - 1 + total) % total); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); setOpenLevel(0); return; }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (hl1 > 0) {
          const d = deptsOfExpanded[hl1 - 1];
          if (d) expandDept(d.id);
        }
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (hl1 === 0) pick({ tenantCode: expandedTenant! });
        else {
          const d = deptsOfExpanded[hl1 - 1];
          if (d) pick({ tenantCode: expandedTenant!, deptId: d.id });
        }
        return;
      }
    } else if (openLevel === 2) {
      const total = teamsOfExpanded.length + 1; // "全部小组" + 各小组
      if (e.key === "ArrowDown") { e.preventDefault(); setHl2((i) => (i + 1) % total); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setHl2((i) => (i - 1 + total) % total); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); setOpenLevel(1); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        if (hl2 === 0) pick({ tenantCode: expandedTenant!, deptId: expandedDept! });
        else {
          const tm = teamsOfExpanded[hl2 - 1];
          if (tm) pick({ tenantCode: expandedTenant!, deptId: expandedDept!, teamId: tm.id });
        }
        return;
      }
    }
  }

  const hasSelection = Boolean(value.tenantCode);

  return (
    <div ref={rootRef} className={`relative ${className}`} onKeyDown={onKeyDown} tabIndex={0}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`h-10 w-full border border-gray-200 rounded-[10px] pl-3.5 pr-2.5 text-sm bg-white focus:outline-none focus:border-[#002FA7] focus:ring-2 focus:ring-[#002FA7]/10 transition-all flex items-center gap-2 ${buttonClassName}`}
      >
        <span className="truncate text-gray-700" title={labelText}>
          {labelText}
        </span>
        {hasSelection && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); pick({}); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); pick({}); } }}
            className="text-gray-300 hover:text-red-500 cursor-pointer inline-flex shrink-0"
            title="清除筛选"
          >
            <X size={13} />
          </span>
        )}
        <ChevronDown size={14} className={`text-gray-400 ml-auto shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className={`absolute z-50 mt-1 flex shadow-xl ${alignRight ? "right-0 flex-row-reverse" : "left-0"}`}>
          {/* 一级菜单：组织 */}
          <ul className="w-64 max-h-[320px] overflow-y-auto bg-white border border-gray-200 rounded-[10px] py-1">
            <li
              className={`px-3 py-2 text-sm cursor-pointer ${hl0 === 0 && openLevel === 0 ? "bg-[#002FA7]/8 text-[#002FA7]" : "hover:bg-gray-50 text-gray-700"}`}
              onMouseEnter={() => { setHl0(0); }}
              onClick={() => pick({})}
            >
              全部组织
            </li>
            {tenants.map((t, i) => {
              const idx = i + 1;
              const isExpanded = expandedTenant === t.code;
              const isHl = hl0 === idx && openLevel === 0;
              return (
                <li key={t.id} className="flex items-stretch group/row" onMouseEnter={() => setHl0(idx)}>
                  <button
                    type="button"
                    onClick={() => pick({ tenantCode: t.code })}
                    className={`flex-1 min-w-0 px-3 py-2 text-sm text-left truncate ${isHl || isExpanded ? "bg-[#002FA7]/8 text-[#002FA7]" : "hover:bg-gray-50 text-gray-700"}`}
                    title={t.name}
                  >
                    {t.name}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); expandTenant(t.code); }}
                    className={`shrink-0 w-9 border-l flex items-center justify-center transition-colors ${isExpanded ? "bg-[#002FA7]/12 text-[#002FA7] border-[#002FA7]/20" : "border-gray-100 text-gray-400 hover:bg-gray-100 hover:text-[#002FA7]"}`}
                    title="展开部门"
                  >
                    <ChevronRight size={16} />
                  </button>
                </li>
              );
            })}
          </ul>

          {/* 二级菜单：部门 */}
          {expandedTenant && (
            <ul className="w-44 max-h-[320px] overflow-y-auto bg-white border border-gray-200 rounded-[10px] py-1 ml-1">
              <li
                className={`px-3 py-2 text-sm cursor-pointer ${hl1 === 0 && openLevel === 1 ? "bg-[#002FA7]/8 text-[#002FA7]" : "hover:bg-gray-50 text-gray-700"}`}
                onMouseEnter={() => { setHl1(0); setOpenLevel(1); }}
                onClick={() => pick({ tenantCode: expandedTenant })}
              >
                全部部门
              </li>
              {deptsOfExpanded.length === 0 ? (
                <li className="px-3 py-2 text-xs text-gray-400 text-center">该组织暂无部门</li>
              ) : (
                deptsOfExpanded.map((d, i) => {
                  const idx = i + 1;
                  const isExpanded = expandedDept === d.id;
                  const isHl = hl1 === idx && openLevel === 1;
                  return (
                    <li key={d.id} className="flex items-stretch group/row" onMouseEnter={() => { setHl1(idx); setOpenLevel(1); }}>
                      <button
                        type="button"
                        onClick={() => pick({ tenantCode: expandedTenant, deptId: d.id })}
                        className={`flex-1 min-w-0 px-3 py-2 text-sm text-left truncate ${isHl || isExpanded ? "bg-[#002FA7]/8 text-[#002FA7]" : "hover:bg-gray-50 text-gray-700"}`}
                        title={d.name}
                      >
                        {d.name}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); expandDept(d.id); }}
                        className={`shrink-0 w-9 border-l flex items-center justify-center transition-colors ${isExpanded ? "bg-[#002FA7]/12 text-[#002FA7] border-[#002FA7]/20" : "border-gray-100 text-gray-400 hover:bg-gray-100 hover:text-[#002FA7]"}`}
                        title="展开小组"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          )}

          {/* 三级菜单：小组 */}
          {expandedDept && (
            <ul className="w-36 max-h-[320px] overflow-y-auto bg-white border border-gray-200 rounded-[10px] py-1 ml-1">
              <li
                className={`px-3 py-2 text-sm cursor-pointer ${hl2 === 0 && openLevel === 2 ? "bg-[#002FA7]/8 text-[#002FA7]" : "hover:bg-gray-50 text-gray-700"}`}
                onMouseEnter={() => { setHl2(0); setOpenLevel(2); }}
                onClick={() => pick({ tenantCode: expandedTenant!, deptId: expandedDept })}
              >
                全部小组
              </li>
              {teamsOfExpanded.length === 0 ? (
                <li className="px-3 py-2 text-xs text-gray-400 text-center">该部门暂无小组</li>
              ) : (
                teamsOfExpanded.map((tm, i) => {
                  const idx = i + 1;
                  const isHl = hl2 === idx && openLevel === 2;
                  return (
                    <li
                      key={tm.id}
                      className={`px-3 py-2 text-sm cursor-pointer truncate ${isHl ? "bg-[#002FA7]/8 text-[#002FA7]" : "hover:bg-gray-50 text-gray-700"}`}
                      onMouseEnter={() => { setHl2(idx); setOpenLevel(2); }}
                      onClick={() => pick({ tenantCode: expandedTenant!, deptId: expandedDept, teamId: tm.id })}
                      title={tm.name}
                    >
                      {tm.name}
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
