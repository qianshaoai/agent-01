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
//   ④ 已有对话上下文 + ≤6 字符 + 命中"确认 / 寒暄"白名单 → 多为确认应答
//      （"好的" "明白" "ok" 等；6.4up R1.1-G 把原裸长度规则收窄为白名单）
//
// 6.4up R1.1-G 修订：原 line 18 「已有对话 + ≤6 字符」会把「职责呢?」「时间呢?」
//   「谁负责?」这类多轮短追问也判为非知识查询，跟 6.4up 1-C 历史拼接路径直接冲突。
//   收窄为白名单后只匹配真正的确认词，正常短追问能进 KB 检索。
const CONFIRM_OR_ACK_RE = /^(好的|好|嗯+|明白|收到|了解|知道了|清楚了|清楚|谢谢|多谢|可以|行|ok|OK)[。.！!~]?$/;

export function isMetaOrChitchatMessage(msg: string, historyLength: number): boolean {
  const t = msg.trim();
  if (!t) return true;
  if (t.length <= 4 && !/[?？]/.test(t)) return true;
  if (/^(你好|您好|嗨|hi|hello|早|早安|早上好|晚上好|在吗|在不在)/i.test(t)) return true;
  if (/^你(能|是|会|的|可以|不是|想|要|有|会不会|能不能|可不可以)/.test(t)) return true;
  if (historyLength > 0 && t.length <= 6 && CONFIRM_OR_ACK_RE.test(t)) return true;
  return false;
}
