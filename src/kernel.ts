/**
 * Kernel —— 用 cordis 装配 daimon 的能力，返回一个可用的 Agent。
 *
 * cordis 是 deepseek-harness 同源的插件内核（Everything is a Plugin），
 * 这里每个能力都是一个 cordis Service，通过 ctx.model / ctx.tools 等方式互相注入。
 */

import { Context } from "cordis";
import * as path from "node:path";
import { ModelService, type ModelConfig } from "./capabilities/model/service.js";
import { ToolsService } from "./capabilities/tools/index.js";
import { MemoryService, type MemoryConfig } from "./capabilities/memory/index.js";
import { SessionService, type SessionConfig } from "./capabilities/session/index.js";
import { Agent } from "./agent/index.js";

export interface KernelConfig {
  /** 数据目录（记忆/会话落盘位置），默认 process.cwd() */
  dataDir?: string;
  model?: ModelConfig;
  memory?: Omit<MemoryConfig, "file">;
  session?: Omit<SessionConfig, "file">;
}

export interface Kernel {
  ctx: Context;
  agent: Agent;
  /** 卸载全部能力（关闭会话 / 释放资源） */
  stop: () => Promise<void>;
}

export async function createKernel(config: KernelConfig = {}): Promise<Kernel> {
  const ctx = new Context();
  const dir = config.dataDir ?? process.cwd();

  const fibers = [
    await ctx.plugin(ModelService, config.model ?? {}),
    await ctx.plugin(ToolsService),
    await ctx.plugin(MemoryService, {
      file: path.join(dir, "memory.json"),
      ...config.memory,
    }),
    await ctx.plugin(SessionService, {
      file: path.join(dir, "session.json"),
      ...config.session,
    }),
  ];

  const agent = new Agent(ctx);

  return {
    ctx,
    agent,
    stop: async () => {
      for (const f of fibers.reverse()) {
        await (f as any).dispose?.();
      }
    },
  };
}

export default createKernel;
