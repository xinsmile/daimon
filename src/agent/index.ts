/**
 * Agent —— daimon 的执行主体。
 *
 * 组合四个 capability（model / tools / memory / session）完成一次对话：
 *   1. 从 memory 召回相关记忆
 *   2. 用 session 历史 + 工具清单组装 prompt
 *   3. 调 model 生成
 *   4. 若模型返回工具调用指令，则执行工具并把结果回灌，最多 maxToolRounds 轮
 *   5. 把最终回复写入 session
 *
 * 工具调用采用「轻量 JSON 指令协议」（不依赖 provider 的 function-calling）：
 * 模型在回复里给出 {"tool": "名字", "args": {...}} 即可触发。
 */

import type { Context } from "cordis";
import type { ModelService } from "../capabilities/model/service.js";
import type { ToolsService } from "../capabilities/tools/index.js";
import type { MemoryService } from "../capabilities/memory/index.js";
import type { SessionService } from "../capabilities/session/index.js";

export interface ChatOptions {
  maxToolRounds?: number;
  provider?: string;
}

export class Agent {
  constructor(private ctx: Context) {}

  private get model(): ModelService | undefined {
    return (this.ctx as any).model;
  }
  private get tools(): ToolsService | undefined {
    return (this.ctx as any).tools;
  }
  private get memory(): MemoryService | undefined {
    return (this.ctx as any).memory;
  }
  private get session(): SessionService | undefined {
    return (this.ctx as any).session;
  }

  /** 组装给模型的 prompt（上下文 = 记忆 + 历史 + 工具清单） */
  private buildPrompt(input: string, recalled: Array<{ content: string }>): string {
    const parts: string[] = [];
    if (this.session?.systemPrompt) parts.push(`[系统]\n${this.session.systemPrompt}`);
    if (recalled.length) {
      parts.push(`[相关记忆]\n${recalled.map((m) => `- ${m.content}`).join("\n")}`);
    }
    if (this.tools) {
      const desc = this.tools.describe();
      if (!desc.startsWith("（当前没有")) {
        parts.push(
          `[可用工具]\n${desc}\n\n如需调用工具，请在回复中单独输出一个 JSON：{"tool":"工具名","args":{...}}`,
        );
      }
    }
    const history = this.session?.history() ?? [];
    if (history.length) {
      parts.push(
        `[对话历史]\n${history.map((m) => `${m.role}: ${m.content}`).join("\n")}`,
      );
    }
    parts.push(`[用户]\n${input}`);
    return parts.join("\n\n");
  }

  /** 从模型回复中解析工具调用指令 */
  private parseToolCall(text: string): { tool: string; args: any } | null {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidates = [fenced?.[1], text].filter(Boolean) as string[];
    for (const c of candidates) {
      const m = c.match(/\{[\s\S]*"tool"[\s\S]*\}/);
      if (!m) continue;
      try {
        const parsed = JSON.parse(m[0]);
        if (parsed && typeof parsed.tool === "string") {
          return { tool: parsed.tool, args: parsed.args ?? {} };
        }
      } catch {
        // 不是合法 JSON，继续尝试下一个候选
      }
    }
    return null;
  }

  async chat(input: string, opts: ChatOptions = {}): Promise<string> {
    if (!this.model) throw new Error("缺少 model 能力（请加载 ModelService）");
    const maxRounds = opts.maxToolRounds ?? 3;

    this.session?.add("user", input);
    const recalled = this.memory?.recall(input, 3) ?? [];

    let finalText = "";
    for (let round = 0; round <= maxRounds; round++) {
      const prompt = this.buildPrompt(input, recalled);
      const res: any = await this.model.generate("text", prompt, { provider: opts.provider });
      const text = res?.text ?? String(res ?? "");

      const call = this.parseToolCall(text);
      if (!call) {
        finalText = text;
        break;
      }
      // 执行工具并把结果写回会话，下一轮模型可见
      const result = await this.tools?.call(call.tool, call.args);
      this.session?.add("tool", JSON.stringify({ tool: call.tool, result }));
      finalText = text;
    }

    if (finalText) this.session?.add("assistant", finalText);
    return finalText;
  }

  /** 记一条长期记忆 */
  remember(content: string, tags: string[] = []) {
    return this.memory?.remember(content, tags);
  }
}

export default Agent;
