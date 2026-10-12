import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { spawn } from "node:child_process";
import { startServer } from "../src/server.js";

const DATA_DIR = "./.tmp-daimon-deploy";
const CONFIG = path.join(DATA_DIR, "config.yaml");

// 用 http 模块直连本地被测服务，避免走被 mock 的 globalThis.fetch
function httpReq(
  port: number,
  method: string,
  p: string,
  opts: { headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; json: () => Promise<any>; text: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: p, method, headers: { ...(opts.body ? { "content-length": Buffer.byteLength(opts.body) } : {}), ...opts.headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, json: async () => JSON.parse(body), text: async () => body });
        });
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function writeConfig(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    CONFIG,
    [
      "default_provider: pollinations",
      "providers:",
      "  pollinations:",
      "    plugin: pollinations",
      "    default_models:",
      "      text: openai",
      "",
    ].join("\n"),
  );
}

test("HTTP 服务：health / providers / 鉴权 / chat / 400 / 404（mock fetch）", async () => {
  writeConfig();
  const origFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (_url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    const last = body?.messages?.[body.messages.length - 1]?.content ?? "";
    return new Response(JSON.stringify({ choices: [{ message: { content: `[echo] ${last}` } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const { port, close } = await startServer({
    config: CONFIG,
    port: 0,
    host: "127.0.0.1",
    token: "secret",
    dataDir: DATA_DIR,
  });
  try {
    const health = await httpReq(port, "GET", "/health");
    assert.equal(health.status, 200);
    const h = await health.json();
    assert.equal(h.ok, true);
    assert.ok(h.providers.includes("pollinations"), "health 应含 pollinations");

    const provs = await httpReq(port, "GET", "/providers");
    assert.equal(provs.status, 200);
    const pj = await provs.json();
    assert.ok(pj.providers.some((x: any) => x.name === "pollinations"));

    // 缺 token -> 401
    const noAuth = await httpReq(port, "POST", "/chat", { headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "hi" }) });
    assert.equal(noAuth.status, 401);

    // 缺 prompt -> 400
    const badPrompt = await httpReq(port, "POST", "/chat", { headers: { "content-type": "application/json", authorization: "Bearer secret" }, body: JSON.stringify({}) });
    assert.equal(badPrompt.status, 400);

    // 正常 chat -> 回显
    const ok = await httpReq(port, "POST", "/chat", { headers: { "content-type": "application/json", authorization: "Bearer secret" }, body: JSON.stringify({ prompt: "你好" }) });
    assert.equal(ok.status, 200);
    const okj = await ok.json();
    assert.ok(String(okj.reply).includes("你好"), `reply 应回显 prompt，实际: ${okj.reply}`);

    // run 缺字段 -> 400
    const badRun = await httpReq(port, "POST", "/run", { headers: { "content-type": "application/json", authorization: "Bearer secret" }, body: JSON.stringify({ provider: "pollinations" }) });
    assert.equal(badRun.status, 400);

    // 未知路由 -> 404
    const nf = await httpReq(port, "GET", "/nope");
    assert.equal(nf.status, 404);
  } finally {
    await close();
    (globalThis as any).fetch = origFetch;
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
});

test("MCP stdio：initialize / tools/list / tools/call（spawn src/cli.ts，确定性）", async () => {
  writeConfig();
  const cliPath = path.resolve(process.cwd(), "src/cli.ts");
  const child = spawn(process.execPath, ["--import", "tsx", cliPath, "--config", CONFIG, "mcp"], {
    cwd: process.cwd(),
  });

  let buf = "";
  const waiters: Array<{ id: number; resolve: (m: any) => void; timer: NodeJS.Timeout }> = [];
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const w = waiters.find((x) => x.id === msg.id);
      if (w) {
        clearTimeout(w.timer);
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  const send = (msg: { jsonrpc: string; id: number; method: string; params?: any }) =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP 超时: ${msg.method}`)), 30000);
      waiters.push({ id: msg.id, resolve, timer });
      child.stdin.write(JSON.stringify(msg) + "\n");
    });

  try {
    const init = await send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    assert.equal(init.result.serverInfo.name, "daimon");
    assert.ok(init.result.capabilities.tools, "应声明 tools 能力");

    const list = await send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const names = list.result.tools.map((t: any) => t.name).sort();
    assert.deepEqual(names, ["chat", "list_providers", "run"]);

    const call = await send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_providers", arguments: {} } });
    const text = call.result.content[0].text;
    assert.ok(text.includes("pollinations"), `list_providers 应含 pollinations: ${text.slice(0, 120)}`);
  } finally {
    child.kill();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
});
