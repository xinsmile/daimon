/**
 * ToolsService —— 工具注册与调用能力（daimon capability）。
 * 工具以 name -> handler 注册；register() 返回 dispose 函数，
 * 配合 cordis 的 ctx.effect() 可实现「插件卸载时自动注销工具」。
 */

import { Service, type Context } from "cordis";

export interface ToolDef<A = any, R = any> {
  name: string;
  description: string;
  /** 供模型阅读的参数说明（简单 schema 描述即可） */
  argsHint?: string;
  handler: (args: A) => R | Promise<R>;
}

export class ToolsService extends Service {
  private tools = new Map<string, ToolDef>();

  constructor(ctx: Context) {
    super(ctx, "tools");
  }

  /** 注册工具，返回注销函数（可交给 ctx.effect 托管） */
  register(def: ToolDef): () => void {
    if (this.tools.has(def.name)) {
      throw new Error(`工具已注册: ${def.name}`);
    }
    this.tools.set(def.name, def);
    return () => {
      this.tools.delete(def.name);
    };
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Array<{ name: string; description: string; argsHint?: string }> {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      argsHint: t.argsHint,
    }));
  }

  /** 调用工具；未注册时抛错 */
  async call(name: string, args: any = {}): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`未注册的工具: ${name}`);
    return await tool.handler(args);
  }

  /** 生成给模型看的「可用工具清单」文本 */
  describe(): string {
    const list = this.list();
    if (!list.length) return "（当前没有可用工具）";
    return list
      .map((t) => `- ${t.name}: ${t.description}${t.argsHint ? ` 参数: ${t.argsHint}` : ""}`)
      .join("\n");
  }
}

export default ToolsService;
