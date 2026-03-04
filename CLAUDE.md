# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start development server (http://localhost:3000)
npm run build     # Production build
npm start         # Run production build
npm run lint      # ESLint check
```

There are no automated tests in this project.

## Environment Setup

Copy `.env.local.example` to `.env.local` and fill in:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # Server-side only, never expose to client
JWT_SECRET=                   # At least 32 chars
# Optional speech recognition:
VOLCENGINE_APP_ID=
VOLCENGINE_ACCESS_TOKEN=
```

Database setup: run `supabase/schema.sql` then `supabase/rpc.sql` in Supabase SQL Editor.

## Architecture

**Multi-tenant AI Agent Portal** — a Next.js 15 App Router application deployed on Vercel that provides a unified chat interface to multiple AI backends (Coze, Dify, Zhipu/GLM, OpenAI-compatible).

### Authentication & Authorization

- `proxy.ts` (Next.js middleware) guards routes based on JWT cookie `ai_portal_token`
- `lib/auth.ts` handles JWT signing/verification (HS256, `jose` library, 7-day TTL)
- Two token types: `{type: "user", userId, phone, tenantCode, ...}` and `{type: "admin", adminId, username}`
- User routes: `/`, `/agents/*`, `/settings`
- Admin routes: `/admin/dashboard*` and siblings
- All server-side DB calls use `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS)

### Multi-tenancy Model

- **Tenants** (enterprises) have a `code`, quota (remaining uses), expiry date, and enabled flag
- **Users** are scoped to a tenant via `tenant_code`; personal users have a null/empty tenant code
- Enterprise users auto-created on first login using the enterprise code as initial password
- `supabase/rpc.sql` provides an atomic quota-deduction stored procedure called after each chat

### AI Adapter Layer (`lib/adapters/index.ts`)

`streamChat(messages, config)` returns an `AsyncGenerator<string>`. The `config.platform` field determines which adapter is used:
- `coze` → Coze `/v3/chat` SSE API
- `dify` → Dify `/v1/chat-messages`
- `zhipu` → Zhipu `/api/paas/v4/chat/completions` (model: glm-4-flash)
- `openai` → any OpenAI-compatible endpoint

Agent API keys are stored encrypted in the `agents.api_key_enc` column.

### Chat Flow (`app/api/agents/[id]/chat/route.ts`)

1. Verify JWT and agent access permissions for the user's tenant
2. Check tenant quota and expiry
3. Load or create a `conversations` record
4. Fetch last 20 turns (40 messages) as context window
5. Call `streamChat()` via the appropriate adapter
6. Stream SSE response to the client
7. Log the action in `logs` table, then atomically deduct quota

### Database Schema (`supabase/schema.sql`)

Key tables: `tenants`, `users`, `admins`, `categories`, `agents`, `tenant_agents` (M2M), `conversations`, `messages`, `notices`, `logs`, `files`.

Default seed data: admin account `admin`/`admin`, test enterprise `DEMO`/`demo123` with 500 quota.

### Mock Data Fallback

`lib/mock-data.ts` provides static fallback data used when the database is unavailable. The home page (`app/page.tsx`) and agent listing API fall back to this data on DB errors.

### File Uploads

Uploaded files are stored in Supabase Storage bucket `uploads`. Extracted text is saved in `files.extracted_text` and optionally appended to chat messages.
