/**
 * 插件注册入口。导入各插件模块以触发其底部的 register() 调用。
 * 注意：必须在 Harness 使用前被导入（harness.ts 已 import 本文件）。
 */

import "./openaiCompatible.js";
import "./agnes.js";
import "./edgeTts.js";
import "./pollinations.js";

export const BUILTIN_PLUGINS = ["openai-compatible", "agnes", "edge-tts", "pollinations"];

/** 内置插件已通过上面的副作用导入完成注册；此函数保持 API 对称。 */
export function loadBuiltinPlugins(): void {
  /* no-op：导入即注册 */
}
