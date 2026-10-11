import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { createKernel } from "../src/index.js";
import "../src/capabilities/model/providers/index.js";

const DATA_DIR = "./.tmp-daimon-e2e";

test("内核→Agent→model→pollinations→session 全链路（mock fetch）", async () => {
  // 用 mock 模拟 Pollinations /openai 返回，验证整条链路（不依赖外网）
  (globalThis as any).fetch = async (_url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    const userMsg = body?.messages?.[body.messages.length - 1]?.content ?? "";
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: `【pollinations】收到：${userMsg}` } }],
        usage: { total_tokens: 5 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const { ctx, agent, stop } = await createKernel({
    model: {
      defaultProvider: "pollinations",
      providers: {
        pollinations: { plugin: "pollinations", defaultModels: { text: "openai" } },
      },
    },
    dataDir: DATA_DIR,
  });

  try {
    const reply = await agent.chat("你是谁？");
    assert.ok(reply.includes("pollinations"), `回复应来自 pollinations 链路，实际: ${reply}`);

    const history = ctx.session!.history();
    assert.ok(history.some((m: any) => m.role === "user" && m.content === "你是谁？"), "session 应记录 user 消息");
    assert.ok(
      history.some((m: any) => m.role === "assistant" && m.content.includes("pollinations")),
      "session 应记录 assistant 回复",
    );
  } finally {
    await stop();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
});
