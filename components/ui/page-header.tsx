import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ icon, title, subtitle, badge, actions, className }: PageHeaderProps) {
  return (
    // 6.1up Phase 2A · 通用 PageHeader 1366 段挤爆 title 修复：
    //   - 顶层 flex-wrap：actions 太多时整体 wrap 到下一行（不再顶截 title）
    //   - title 区 flex-1 min-w-0：优先占空间但允许压缩
    //   - actions 区去掉 shrink-0、加 flex-wrap justify-end：按钮多时自身 wrap、保持右对齐
    <div className={cn("flex items-start justify-between gap-4 pb-1 flex-wrap", className)}>
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {icon && (
          <div className="flex items-center justify-center w-10 h-10 rounded-[10px] bg-[#002FA7]/8 text-[#002FA7] shrink-0">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="h-page truncate">{title}</h1>
            {badge}
          </div>
          {subtitle && <p className="t-sm t-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap justify-end">{actions}</div>}
    </div>
  );
}
