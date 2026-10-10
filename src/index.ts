/**
 * 公共导出入口。
 */

export * from "./core/types.js";
export * from "./core/errors.js";
export * from "./core/results.js";
export * from "./core/plugin.js";
export * from "./core/keyManager.js";
export * from "./core/harness.js";
export * from "./config.js";

// 触发内置插件注册（副作用导入）
import "./plugins/index.js";
