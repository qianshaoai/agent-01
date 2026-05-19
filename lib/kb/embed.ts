// ⚠⚠⚠ 临时桩 · 5.19up 知识库 方案B 联调用 ⚠⚠⚠
// 本文件的真实现由方案 A 的 PR-A2 交付（见「智能体知识库-并行开发统一约束」§3.4、§4.2）。
// A 的分支合并时以 A 的 lib/kb/embed.ts 为准；合并冲突时取 A 版，本桩作废。
// B 不得把本桩当作最终交付。
//
// 桩行为：两个函数都直接抛错。这样 —— B 的检索链路（lib/kb/retrieve.ts）在 A 未交付
// 前调用即抛错，被 chat route 的 try/catch 捕获 → 降级为「无知识库正常回答」，
// 对话不受影响。即「A 没上之前，知识库检索一律降级」，符合约束 §六的并行开发方式。
//
// 冻结契约（约束 §3.4）：
//   export async function embedTexts(texts: string[]): Promise<number[][]>;
//   export async function embedQuery(text: string): Promise<number[]>;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  throw new Error(
    `[kb/embed 桩] embedTexts 未实现（待方案A PR-A2 交付）—— 收到 ${texts.length} 段文本`,
  );
}

export async function embedQuery(text: string): Promise<number[]> {
  throw new Error(
    `[kb/embed 桩] embedQuery 未实现（待方案A PR-A2 交付）—— 收到 ${text.length} 字查询`,
  );
}
