export function AdminPageFrame({
  children,
  fullBleed = false,
  hideFooter = false,
}: {
  children: React.ReactNode;
  fullBleed?: boolean;
  hideFooter?: boolean;
}) {
  return (
    <div className="min-h-full flex flex-col">
      <div
        className={
          fullBleed
            ? "flex-1 w-full"
            : "flex-1 p-5 sm:p-7 max-w-[1600px] w-full mx-auto"
        }
      >
        {children}
      </div>
      {!hideFooter && (
        <footer className="px-6 py-3 text-[11px] text-gray-400 border-t border-gray-100 bg-white">
          © 2026 前哨科技（QianShao.AI）管理后台
        </footer>
      )}
    </div>
  );
}

/**
 * 兼容迁移期旧页面命名。该组件现在只负责页面内容区，不再创建 Shell
 * 或请求管理员会话；持久化 Shell 由 app/admin/(console)/layout.tsx 提供。
 */
export const AdminLayout = AdminPageFrame;
