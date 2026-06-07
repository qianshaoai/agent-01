/**
 * 6.4up v2 Phase A · 资源 access adapter 统一注册入口
 *
 * 任何使用 requireAccess() 的代码路径在启动前 import 本文件，确保所有 13 个 adapter
 * 已注册到 access-facade 的 REGISTRY。建议 instrumentation 在 lib/access-facade 的
 * consumer 路由首次 import 时 transitively 加载本 index。
 *
 * 14 个 resource：
 *   workflow / agent / agent_draft / kb / model_provider / notice
 *   user / tenant / category / dept / team / user_group / audit / setting
 */

import "./workflow";
import "./agent";
import "./agent-draft";
import "./knowledge-base";
import "./model-provider";
import "./notice";
import "./user";
import "./tenant";
import "./category";
import "./dept";
import "./team";
import "./user-group";
import "./audit";
import "./setting";

export {};
