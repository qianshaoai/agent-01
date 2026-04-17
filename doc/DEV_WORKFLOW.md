# 本地开发流程

环境准备请先看项目根目录的 `README.md` 和 `CLAUDE.md`。本文档只补充**本地启停与常见坑点**。

---

## 启动

```bash
npm run dev
```

默认监听 `http://localhost:3000`。

Next.js 16 使用 Turbopack，首次启动后的首个页面编译可能需要 10-60 秒属于正常，后续热重载会很快。

---

## 停止

`Ctrl + C`。

如果终端卡住或进程未正常退出，查看并手动杀进程：

- **Windows**：`taskkill //F //IM node.exe`
- **macOS / Linux**：`pkill -f "next dev"`

---

## 端口被占用

报错 `EADDRINUSE: address already in use :::3000` 时查占用：

- **Windows**：`netstat -ano | findstr :3000`
- **macOS / Linux**：`lsof -i :3000`

然后按 PID 杀掉老进程（通常是之前没关的 VSCode 终端）。

---

## `.next/dev/lock` 锁文件冲突

启动时报 lock 文件相关错误，说明有旧 dev 进程没正常退出：

```bash
rm -rf .next/dev/lock
```

Windows PowerShell：`Remove-Item -Recurse -Force .next/dev/lock`

---

## 质量检查

代码提交前建议本地跑一次质量门禁：

```bash
npm run ci:check
```

等价于：`lint + tsc --noEmit + build + test`（test 当前为 echo 占位）。

单独跑某一步：

```bash
npm run ci:lint        # ESLint
npm run ci:typecheck   # TypeScript
npm run ci:build       # Next.js build
```

CI 平台模板见 `doc/ci-examples/`。

---

## 常见坑点

### Node 内存不足

编译大页面时偶发 `memory allocation ... failed`：

```bash
NODE_OPTIONS="--max-old-space-size=4096" npm run dev
```

### Windows 本地 build EPERM / memory allocation failed

`npm run build` 或 `npm run dev` 报 `spawn EPERM` 或 `memory allocation of X bytes failed`，**根因几乎都是 C: 盘空间紧张**：

- Node V8 heap 扩展依赖 Windows pagefile.sys（默认在 C:）
- C: 盘可用空间不足时 pagefile 无法扩展，Node 分配内存失败或子进程启动被系统拒绝（表现为 EPERM）

**实测阈值**：
- C: 可用 < 2GB → 基本必定失败
- C: 可用 ≥ 5GB → 可稳定 build（6.3s 编译完成）

**处理（按优先级）**：

1. 清理 C: 盘空间到 ≥ 5GB：
   - Windows 更新缓存：`cleanmgr` 勾选 "Windows 更新清理"，通常能释放 5-8GB
   - 回收站、临时文件
2. 把 Node 临时目录永久重定向到大盘（一次性设置）：
   ```
   setx TMP "G:\dev-cache\node-tmp"
   setx TEMP "G:\dev-cache\node-tmp"
   setx NPM_CONFIG_CACHE "G:\dev-cache\npm-cache"
   ```
3. 给 build 命令加大 heap 上限：
   ```
   NODE_OPTIONS="--max-old-space-size=4096" npm run build
   ```
4. 把项目目录加入 Windows Defender 排除列表（缓解 Defender 偶发干扰）
5. 在 WSL / CI 中构建，Linux 环境完全不受影响

### Windows 系统盘空间紧

dev server 需要 pagefile 扩展内存，系统盘（通常 C:）空间不足时会直接崩溃。清理建议：

- Windows Update 缓存：`cleanmgr` 选择"Windows 更新清理"
- 把 npm 缓存、Node temp 重定向到大盘：
  ```
  setx NPM_CONFIG_CACHE "D:\dev-cache\npm-cache"
  setx TMP "D:\dev-cache\node-tmp"
  setx TEMP "D:\dev-cache\node-tmp"
  ```

### Turbopack 首次编译慢

Next.js 16 首次请求某个路由时会触发 Turbopack 增量编译，10~60 秒属正常。后续热重载通常 <1 秒。

### 中文源码编码

项目根目录已有 `.editorconfig`，所有源码强制 UTF-8 + LF。VSCode / Cursor / WebStorm 默认支持，无需额外配置。

---

## 环境变量

见 `README.md` 的 Environment Setup 小节。本地开发必填：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`（至少 32 字符）

可选（语音识别）：`VOLCENGINE_APP_ID`、`VOLCENGINE_ACCESS_TOKEN`。

---

## 数据库迁移

Supabase SQL 迁移文件位于 `supabase/migration_v*.sql`。新建库按以下顺序执行：

1. `supabase/schema.sql`
2. `supabase/rpc.sql`
3. 按版本号依次执行 `migration_v*.sql`（v17、v18、v19…）
