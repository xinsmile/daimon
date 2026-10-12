/**
 * HTTP API 服务（零依赖，仅用 Node 内置 http）。
 *
 * 把 daimon 的 Agent 与模型能力包成 HTTP 接口，便于自托管 / 前端调用 / 容器部署。
 *
 * 启动：
 *   node dist/cli.js serve --config config.yaml --port 3000 --host 0.0.0.0
 *   # 或设置鉴权： --token xxx  或环境变量 DAEMON_API_TOKEN=xxx
 *
 * 接口：
 *   GET  /health            公开：返回 { ok, providers }
 *   GET  /providers         公开：返回已启用 provider 列表
 *   POST /chat              { prompt, provider?, dataDir? } -> { reply }
 *   POST /run               { provider, modality, prompt, model?, output?, params? } -> 生成结果
 *   鉴权：若设置了 token，/chat 与 /run 需带 `Authorization: Bearer <token>`
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { Harness } from "./capabilities/model/harness.js";
import { createKernel, type Kernel } from "./kernel.js";
import "./capabilities/model/providers/index.js";

interface ServerOptions {
  config?: string;
  port?: number;
  host?: string;
  token?: string;
  dataDir?: string;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function formatGenerateResult(result: any): Record<string, unknown> {
  if (!result || typeof result !== "object") return { value: String(result) };
  if (typeof result.text === "string") return { text: result.text };
  if (Array.isArray(result.urls) && result.urls.length) return { urls: result.urls };
  if (typeof result.url === "string" && result.url) return { url: result.url };
  if (result.data) {
    return { bytes: result.data.length, path: result.path ?? null, format: result.format ?? null };
  }
  return result as Record<string, unknown>;
}

export async function startServer(opts: ServerOptions): Promise<{ port: number; close: () => Promise<void> }> {
  const configPath = opts.config ?? (existsSync("config.yaml") ? "config.yaml" : undefined);
  if (!configPath) {
    throw new Error("serve 需要 --config 指定配置文件（或当前目录存在 config.yaml）");
  }
  const port = Number(opts.port ?? 3000);
  const host = opts.host ?? "0.0.0.0";
  const token = opts.token ?? process.env.DAEMON_API_TOKEN ?? "";
  const dataDir = opts.dataDir ?? process.cwd();

  // 懒加载：避免无请求时不必要地建连
  let kernel: Kernel | null = null;
  let agent: Kernel["agent"] | null = null;
  let harness: Harness | null = null;

  async function getAgent(): Promise<Kernel["agent"]> {
    if (!agent) {
      kernel = await createKernel({ model: { configFile: configPath }, dataDir });
      agent = kernel.agent;
    }
    return agent;
  }
  function getHarness(): Harness {
    if (!harness) harness = Harness.fromFile(configPath!);
    return harness;
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const path = url.pathname;

      // 鉴权（仅保护写接口）
      if ((path === "/chat" || path === "/run") && token) {
        const auth = req.headers["authorization"] ?? "";
        if (auth !== `Bearer ${token}`) {
          sendJson(res, 401, { error: "unauthorized" });
          return;
        }
      }

      if (req.method === "GET" && path === "/health") {
        const h = getHarness();
        sendJson(res, 200, { ok: true, providers: h.listProviders() });
        return;
      }

      if (req.method === "GET" && path === "/providers") {
        const h = getHarness();
        sendJson(res, 200, {
          providers: h.listProviders().map((name) => {
            const info = h.providerInfo(name);
            return { name: info.name, description: info.description, modalities: info.modalities };
          }),
        });
        return;
      }

      if (req.method === "POST" && path === "/chat") {
        const raw = await readBody(req);
        let body: any;
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          sendJson(res, 400, { error: "invalid JSON" });
          return;
        }
        if (!body.prompt || typeof body.prompt !== "string") {
          sendJson(res, 400, { error: "prompt 必填" });
          return;
        }
        const a = await getAgent();
        const reply = await a.chat(body.prompt, { provider: body.provider });
        sendJson(res, 200, { reply });
        return;
      }

      if (req.method === "POST" && path === "/run") {
        const raw = await readBody(req);
        let body: any;
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          sendJson(res, 400, { error: "invalid JSON" });
          return;
        }
        if (!body.provider || !body.modality || !body.prompt) {
          sendJson(res, 400, { error: "provider / modality / prompt 必填" });
          return;
        }
        const h = getHarness();
        const genOpts: Record<string, unknown> = {};
        if (body.model) genOpts.model = body.model;
        if (body.output) genOpts.output = body.output;
        if (body.params) {
          try {
            Object.assign(genOpts, typeof body.params === "string" ? JSON.parse(body.params) : body.params);
          } catch {
            sendJson(res, 400, { error: "params 必须是合法 JSON" });
            return;
          }
        }
        const result = await h.generate(body.provider, body.modality, body.prompt, genOpts);
        sendJson(res, 200, formatGenerateResult(result));
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err: any) {
      sendJson(res, 500, { error: String(err?.message ?? err) });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const boundPort = (server.address() as import("node:net").AddressInfo | null)?.port ?? port;
  console.log(`daimon HTTP 服务已启动: http://${host}:${boundPort}  (config=${configPath}, 鉴权=${token ? "开启" : "关闭"})`);

  return {
    port: boundPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}

export default startServer;
