/**
 * MCP stdio Server（零依赖，仅用 Node 标准库实现 JSON-RPC 2.0 over stdio）。
 *
 * 把 daimon 暴露成 MCP 工具，供 Claude / 其它 MCP 客户端通过 stdio 调用。
 *
 * 启动：
 *   node dist/cli.js mcp --config config.yaml
 *
 * 暴露的工具：
 *   chat            { prompt, provider? }                  -> 文本回复
 *   run             { provider, modality, prompt, ... }    -> 模型生成（文本/图像/音频/视频）
 *   list_providers  {}                                     -> 已启用 provider 列表
 *
 * 协议：MCP 2024-11-05；stdout 只输出换行分隔的 JSON-RPC 消息，调试信息走 stderr。
 */

import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { Harness } from "./capabilities/model/harness.js";
import { createKernel, type Kernel } from "./kernel.js";
import "./capabilities/model/providers/index.js";

interface McpOptions {
  config?: string;
  dataDir?: string;
}

const TOOLS = [
  {
    name: "chat",
    description: "与 daimon Agent 进行一轮对话（含记忆/会话/工具回灌）。",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "用户输入" },
        provider: { type: "string", description: "可选，指定模型 provider（如 pollinations/agnes）" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "run",
    description: "直接调用某 provider 的某一模态生成（text/image/audio/video）。",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "provider 名称" },
        modality: { type: "string", description: "模态：text / image / audio / video" },
        prompt: { type: "string", description: "提示词" },
        model: { type: "string", description: "可选，指定模型名" },
        output: { type: "string", description: "可选，输出文件路径" },
        params: { type: "string", description: "可选，附加 JSON 参数" },
      },
      required: ["provider", "modality", "prompt"],
    },
  },
  {
    name: "list_providers",
    description: "列出当前已启用的 provider 及其支持模态。",
    inputSchema: { type: "object", properties: {} },
  },
];

function formatGenerateResult(result: any): string {
  if (!result || typeof result !== "object") return String(result);
  if (typeof result.text === "string") return result.text;
  if (Array.isArray(result.urls) && result.urls.length) return result.urls.join("\n");
  if (typeof result.url === "string" && result.url) return result.url;
  if (result.data) return `[二进制 ${result.data.length} 字节${result.path ? "，已写入 " + result.path : ""}]`;
  return JSON.stringify(result);
}

export async function startMcpServer(opts: McpOptions): Promise<void> {
  const configPath = opts.config ?? (existsSync("config.yaml") ? "config.yaml" : undefined);
  if (!configPath) {
    process.stderr.write("mcp 需要 --config 指定配置文件（或当前目录存在 config.yaml）\n");
    process.exit(2);
  }
  const dataDir = opts.dataDir ?? process.cwd();

  let kernel: Kernel | null = null;
  let agent: Kernel["agent"] | null = null;
  let harness: Harness | null = null;

  async function getAgent() {
    if (!agent) {
      kernel = await createKernel({ model: { configFile: configPath }, dataDir });
      agent = kernel.agent;
    }
    return agent;
  }
  function getHarness() {
    if (!harness) harness = Harness.fromFile(configPath!);
    return harness;
  }

  const write = (msg: Record<string, unknown>) => {
    process.stdout.write(JSON.stringify(msg) + "\n");
  };

  const rl = createInterface({ input: process.stdin });

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: any;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return; // 忽略非法帧
    }
    try {
      const { id, method, params } = msg;
      if (method === "initialize") {
        write({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "daimon", version: "0.1.0" },
          },
        });
        return;
      }
      if (method === "notifications/initialized") return; // 通知，无需回复
      if (method === "ping") {
        write({ jsonrpc: "2.0", id, result: {} });
        return;
      }
      if (method === "tools/list") {
        write({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
        return;
      }
      if (method === "tools/call") {
        const name = params?.name;
        const args = params?.arguments ?? {};
        try {
          let text: string;
          if (name === "chat") {
            if (!args.prompt) throw new Error("prompt 必填");
            const a = await getAgent();
            text = await a.chat(args.prompt, { provider: args.provider });
          } else if (name === "run") {
            if (!args.provider || !args.modality || !args.prompt) throw new Error("provider/modality/prompt 必填");
            const h = getHarness();
            const genOpts: Record<string, unknown> = {};
            if (args.model) genOpts.model = args.model;
            if (args.output) genOpts.output = args.output;
            if (args.params) {
              genOpts.params = typeof args.params === "string" ? JSON.parse(args.params) : args.params;
            }
            text = formatGenerateResult(await h.generate(args.provider, args.modality, args.prompt, genOpts));
          } else if (name === "list_providers") {
            const h = getHarness();
            text = JSON.stringify(
              h.listProviders().map((n) => {
                const i = h.providerInfo(n);
                return { name: i.name, description: i.description, modalities: i.modalities };
              }),
              null,
              2,
            );
          } else {
            throw new Error(`未知工具: ${name}`);
          }
          write({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: String(text) }] },
          });
        } catch (err: any) {
          write({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: `错误: ${String(err?.message ?? err)}` }], isError: true },
          });
        }
        return;
      }
      // 未知方法
      if (id !== undefined) {
        write({ jsonrpc: "2.0", id, error: { code: -32601, message: `方法未实现: ${method}` } });
      }
    } catch (err: any) {
      if (msg?.id !== undefined) {
        write({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: String(err?.message ?? err) } });
      }
    }
  });

  process.stderr.write("daimon MCP stdio 服务已就绪\n");
}

export default startMcpServer;
