# 智能体统一门户 — 部署指南

## 一、环境要求

- Node.js 18+
- npm 9+
- Supabase 项目（免费套餐即可）
- Vercel 账号（可选，用于生产部署）

---

## 二、Supabase 配置

### 1. 创建项目

前往 [https://supabase.com/dashboard](https://supabase.com/dashboard)，新建项目，记录以下信息：

| 信息 | 位置 |
|------|------|
| Project URL | Settings → API → Project URL |
| anon key | Settings → API → Project API keys → anon public |
| service_role key | Settings → API → Project API keys → service_role secret |

### 2. 执行数据库 Schema

在 Supabase Dashboard → SQL Editor 中，依次执行：

1. `supabase/schema.sql` — 建表、索引、测试数据
2. `supabase/rpc.sql` — 配额原子扣减函数

执行后数据库包含：
- 管理员账号：`admin` / 密码 `admin`
- 测试企业码：`DEMO` / 企业密码 `demo123`

### 3. 创建 Storage Bucket

在 Supabase Dashboard → Storage 中创建名为 `uploads` 的公开 bucket，用于文件上传。

---

## 三、本地开发

### 1. 克隆并安装依赖

```bash
cd portal
npm install
```

### 2. 配置环境变量

复制示例文件并填入真实值：

```bash
cp .env.local.example .env.local
```

编辑 `.env.local`：

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
JWT_SECRET=your-random-32-char-secret
```

生成 JWT_SECRET 的方法：
```bash
openssl rand -base64 32
# 或
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3. 启动开发服务器

```bash
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000)

---

## 四、账号体系说明

### 用户登录（`/login`）

| 字段 | 说明 |
|------|------|
| 手机号 | 任意手机号（企业首次登录自动创建账号） |
| 企业码 | 由管理员创建，留空则为个人空间（默认密码 `000000`） |
| 密码 | 企业码初始密码，首次登录后提示修改 |

### 管理员登录（`/admin`）

| 账号 | 密码 |
|------|------|
| admin | admin |

> 生产环境请立即修改管理员密码（直接在 Supabase SQL Editor 中更新 `admins` 表的 `pwd_hash`）。

---

## 五、智能体配置

在管理后台 → 智能体管理中新增智能体时，支持以下平台：

| 平台 | platform 值 | API 说明 |
|------|------------|---------|
| 扣子 (Coze) | `coze` | 填入 Bot ID 和 API Key |
| Dify | `dify` | 填入应用 URL 和 API Key |
| 智谱 (Zhipu/GLM) | `zhipu` | 填入 API Key，模型固定为 glm-4-flash |
| OpenAI 兼容 | `openai` | 填入 Base URL、API Key 和模型名 |

---

## 六、Vercel 生产部署

### 1. 连接仓库

将代码推送至 GitHub，在 Vercel 导入项目，框架选择 **Next.js**。

### 2. 配置环境变量

在 Vercel 项目 Settings → Environment Variables 中添加：

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
JWT_SECRET
```

可选（语音识别）：
```
VOLCENGINE_APP_ID
VOLCENGINE_ACCESS_TOKEN
```

### 3. 部署

点击 Deploy，部署完成后访问分配的域名即可。

---

## 七、目录结构

```
portal/
├── app/
│   ├── (用户端)
│   │   ├── page.tsx          # 首页 - 智能体列表
│   │   ├── login/            # 登录页
│   │   ├── agents/[id]/      # 聊天界面
│   │   └── settings/         # 账户设置
│   ├── admin/                # 管理后台
│   │   ├── page.tsx          # 管理员登录
│   │   ├── dashboard/        # 控制台
│   │   ├── tenants/          # 企业码管理
│   │   ├── agents/           # 智能体管理
│   │   ├── notices/          # 公告管理
│   │   ├── analytics/        # 用量看板
│   │   └── logs/             # 操作日志
│   └── api/                  # API 路由
├── components/
│   ├── layout/               # 布局组件
│   └── ui/                   # 通用 UI 组件
├── lib/
│   ├── auth.ts               # JWT 认证工具
│   ├── db.ts                 # Supabase 客户端
│   ├── mock-data.ts          # Mock 数据（无 DB 时的回退）
│   └── adapters/             # AI 平台适配器
├── supabase/
│   ├── schema.sql            # 数据库建表脚本
│   └── rpc.sql               # 存储过程
├── proxy.ts                  # 路由保护中间件
└── .env.local.example        # 环境变量示例
```
