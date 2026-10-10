/**
 * daimon 公共入口。
 *
 * 分层：
 *   - capabilities/model  免费模型接入 + 多 Key 轮转（provider 插件体系）
 *   - capabilities/tools   工具注册与调用
 *   - capabilities/memory  长期记忆
 *   - capabilities/session 会话持久化
 *   - agent                执行主体（组合上述能力）
 *   - kernel               用 cordis 装配能力
 */

// —— 模型能力（原有实现）
export * from "./capabilities/model/types.js";
export * from "./capabilities/model/errors.js";
export * from "./capabilities/model/results.js";
export * from "./capabilities/model/plugin.js";
export * from "./capabilities/model/keyManager.js";
export * from "./capabilities/model/harness.js";
export * from "./capabilities/model/config.js";
export { ModelService, type ModelConfig } from "./capabilities/model/service.js";

// —— 新增能力
export { ToolsService, type ToolDef } from "./capabilities/tools/index.js";
export {
  MemoryService,
  type MemoryItem,
  type MemoryConfig,
} from "./capabilities/memory/index.js";
export {
  SessionService,
  type Message,
  type Role,
  type SessionConfig,
} from "./capabilities/session/index.js";

// —— 执行主体与内核
export { Agent, type ChatOptions } from "./agent/index.js";
export { createKernel, type Kernel, type KernelConfig } from "./kernel.js";

// 触发内置 provider 注册（openai-compatible / agnes / edge-tts）
import "./capabilities/model/providers/index.js";
