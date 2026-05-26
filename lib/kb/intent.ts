// 5.21up · 本轮消息是否为"非知识查询"（寒暄 / 元能力提问 / 短澄清）。
//   命中则跳过 KB 检索 + 不注入硬规则，让模型按 system_prompt 自然回答。
//   背景：5.20up 把"KB 空命中"也注入"必须答没找到资料"硬规则，对工作流接力首条 /
//   闲聊澄清这类非知识查询造成误伤（用户问"你好"被吐"知识库中没有找到相关资料"）；
//   此判断把误伤场景挡在 KB 检索之前。
//
//   规则（任意一条命中即视为非知识查询）：
//   ① 极短（≤4 字符）且不含问号 → 寒暄 / 感叹 / 确认（"你好" "谢谢" "好的" "嗯"）
//   ② 寒暄开头（"你好" "您好" "在吗" "hi" 等）
//   ③ 元能力提问（"你能..." "你是..." "你会..." 等，问 agent 自身而非 KB 内容）
//   ④ 已有对话上下文 + ≤6 字符 → 多为追问 / 反问 / 澄清（"整理什么?" "再说一下?"）
export function isMetaOrChitchatMessage(msg: string, historyLength: number): boolean {
  const t = msg.trim();
  if (!t) return true;
  if (t.length <= 4 && !/[?？]/.test(t)) return true;
  if (/^(你好|您好|嗨|hi|hello|早|早安|早上好|晚上好|在吗|在不在)/i.test(t)) return true;
  if (/^你(能|是|会|的|可以|不是|想|要|有|会不会|能不能|可不可以)/.test(t)) return true;
  if (historyLength > 0 && t.length <= 6) return true;
  return false;
}
