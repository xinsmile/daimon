/**
 * 验证 daimon 的 cordis 内核与新增能力（tools / memory / session / agent）。
 * 用临时目录落盘，不污染仓库。
 *
 * 注意：cordis 的 ctx 是 Proxy，不能对 ctx.model 直接赋值（会拦截并报
 * "cannot set property in multiple fibers"）。要替换能力，应当通过
 * ctx.plugin() 注入同名的 Service——这也是插件化的正确用法。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Context, Service } from "cordis";

import { createKernel } from "../src/kernel.js";
import { Agent } from "../src/agent/index.js";
import { ToolsService } from "../src/capabilities/tools/index.js";
import { MemoryService } from "../src/capabilities/memory/index.js";
import { SessionService } from "../src/capabilities/session/index.js";
import type { ModelService } from "../src/capabilities/model/service.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "daimon-test-"));
}

/** 假的 model 能力：按序返回预设回复，用于测试 Agent 而不依赖真实 API */
class FakeModelService extends Service {
  private replies: string[];
  constructor(ctx: Context, config: { replies: string[] }) {
    super(ctx, "model");
    this.replies = [...config.replies];
  }
  async generate(): Promise<{ text: string }> {
    return { text: this.replies.shift() ?? "" };
  }
}

/** 手动装配：model 用假实现，其余用真实能力 */
async function setupAgent(replies: string[]) {
  const dir = tmpDir();
  const ctx = new Context();
  await ctx.plugin(FakeModelService, { replies });
  await ctx.plugin(ToolsService);
  await ctx.plugin(MemoryService, { file: path.join(dir, "memory.json") });
  await ctx.plugin(SessionService, { file: path.join(dir, "session.json") });
  return { ctx, agent: new Agent(ctx), dir };
}

test("内核装配：四个能力全部注入到 ctx", async () => {
  const dir = tmpDir();
  const { ctx, stop } = await createKernel({ dataDir: dir });

  assert.ok((ctx as any).model, "model 能力未注入");
  assert.ok((ctx as any).tools, "tools 能力未注入");
  assert.ok((ctx as any).memory, "memory 能力未注入");
  assert.ok((ctx as any).session, "session 能力未注入");

  await stop();
});

test("tools：注册、列举与调用", async () => {
  const dir = tmpDir();
  const { ctx, stop } = await createKernel({ dataDir: dir });
  const tools = (ctx as any).tools as ToolsService;

  const dispose = tools.register({
    name: "add",
    description: "两数相加",
    argsHint: "{a:number,b:number}",
    handler: (args: any) => args.a + args.b,
  });

  assert.ok(tools.has("add"));
  assert.equal(tools.list().length, 1);
  assert.equal(await tools.call("add", { a: 2, b: 3 }), 5);

  await assert.rejects(() => tools.call("nope"), /未注册的工具/);

  dispose();
  assert.ok(!tools.has("add"));
  await stop();
});

test("memory：记住并可召回", async () => {
  const dir = tmpDir();
  const { ctx, stop } = await createKernel({ dataDir: dir });
  const memory = (ctx as any).memory as MemoryService;

  memory.remember("用户喜欢用 TypeScript", ["偏好"]);
  memory.remember("项目叫 daimon，基于 cordis", ["项目"]);

  assert.equal(memory.all().length, 2);

  const hit = memory.recall("daimon 基于什么");
  assert.ok(hit.length >= 1, "应召回至少一条");
  assert.ok(hit[0].content.includes("daimon"));
  assert.ok(fs.existsSync(path.join(dir, "memory.json")), "记忆未落盘");

  await stop();
});

test("session：历史记录与落盘", async () => {
  const dir = tmpDir();
  const { ctx, stop } = await createKernel({
    dataDir: dir,
    session: { systemPrompt: "你是助手" },
  });
  const session = (ctx as any).session as SessionService;

  session.add("user", "你好");
  session.add("assistant", "嗨");

  assert.equal(session.history().length, 2);
  assert.equal(session.context()[0].role, "system");
  assert.equal(session.context()[0].content, "你是助手");
  assert.ok(fs.existsSync(path.join(dir, "session.json")), "会话未落盘");

  await stop();
});

test("agent.chat：调用模型并把回复写入会话", async () => {
  const { ctx, agent } = await setupAgent(["这是回复"]);

  const out = await agent.chat("你好");
  assert.equal(out, "这是回复");

  const session = (ctx as any).session as SessionService;
  const roles = session.history().map((m) => m.role);
  assert.ok(roles.includes("user"), "应记录用户输入");
  assert.ok(roles.includes("assistant"), "应记录助手回复");
});

test("agent：模型返回工具指令时执行工具并回灌", async () => {
  const { ctx, agent } = await setupAgent([
    '{"tool":"upper","args":{"text":"hi"}}',
    "完成",
  ]);
  const tools = (ctx as any).tools as ToolsService;

  let called = false;
  tools.register({
    name: "upper",
    description: "转大写",
    handler: (args: any) => {
      called = true;
      return String(args.text).toUpperCase();
    },
  });

  const out = await agent.chat("把 hi 转大写");
  assert.ok(called, "工具应被调用");
  assert.equal(out, "完成");

  const session = (ctx as any).session as SessionService;
  assert.ok(
    session.history().some((m) => m.role === "tool"),
    "工具结果应写入会话",
  );
});

test("model 能力：provider 列表可查询（真实 ModelService）", async () => {
  const dir = tmpDir();
  const { ctx, stop } = await createKernel({ dataDir: dir });
  const model = (ctx as any).model as ModelService;

  // 未配置 provider 时列表为空，但接口可用
  assert.ok(Array.isArray(model.listProviders()));
  await stop();
});
