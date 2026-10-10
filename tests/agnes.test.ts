import { test } from "node:test";
import assert from "node:assert/strict";
import { QuotaExhausted } from "../src/capabilities/model/errors.js";
import { ProviderConfig } from "../src/capabilities/model/config.js";
import { buildPlugin } from "../src/capabilities/model/plugin.js";
import type { BasePlugin } from "../src/capabilities/model/plugin.js";
import "../src/capabilities/model/providers/index.js";

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeAgnes(keys: string[]): BasePlugin {
  const cfg = new ProviderConfig({
    name: "agnes",
    baseUrl: "https://api.agnes-ai.cn/v1",
    keys,
    defaultModels: { text: "t", image: "i", video: "v", audio: "a", multimodal: "t" },
  });
  return buildPlugin("agnes", cfg);
}

test("文本生成解析", async () => {
  let calls = 0;
  (globalThis as any).fetch = async () => {
    calls++;
    return jsonResponse({ choices: [{ message: { content: "你好" } }], usage: { total_tokens: 3 } });
  };
  const p = makeAgnes(["k1"]);
  const res: any = await p.generate("text", "hi");
  assert.equal(res.text, "你好");
  assert.equal(res.usage.total_tokens, 3);
  assert.ok(calls >= 1);
});

test("多模态含 image_url", async () => {
  let sent: any;
  (globalThis as any).fetch = async (_url: any, init: any) => {
    sent = JSON.parse(init.body);
    return jsonResponse({ choices: [{ message: { content: "猫" } }], usage: {} });
  };
  const p = makeAgnes(["k1"]);
  const res: any = await p.generate("multimodal", "描述图片", { images: ["http://img/x.png"] });
  assert.equal(res.text, "猫");
  assert.equal(sent.messages[0].content[1].image_url.url, "http://img/x.png");
});

test("视频直出 URL", async () => {
  (globalThis as any).fetch = async () => jsonResponse({ url: "http://v.mp4", status: "succeeded" });
  const p = makeAgnes(["k1"]);
  const res: any = await p.generate("video", "cat");
  assert.equal(res.url, "http://v.mp4");
});

test("视频提交+轮询", async () => {
  let n = 0;
  (globalThis as any).fetch = async () => {
    n++;
    if (n === 1) return jsonResponse({ id: "abc" });
    return jsonResponse({ status: "succeeded", url: "http://v2.mp4" });
  };
  const p = makeAgnes(["k1"]);
  const res: any = await p.generate("video", "city");
  assert.equal(res.url, "http://v2.mp4");
});

test("音频返回字节", async () => {
  (globalThis as any).fetch = async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  const p = makeAgnes(["k1"]);
  const res: any = await p.generate("audio", "hello");
  assert.ok(res.data instanceof Uint8Array);
  assert.equal(res.data.length, 3);
});

test("额度耗尽自动轮换", async () => {
  let n = 0;
  (globalThis as any).fetch = async () => {
    n++;
    if (n === 1) return new Response("quota exceeded", { status: 429, headers: { "content-type": "text/plain" } });
    return jsonResponse({ choices: [{ message: { content: "ok" } }], usage: {} });
  };
  const p = makeAgnes(["k1", "k2"]);
  const res: any = await p.generate("text", "hi");
  assert.equal(res.text, "ok");
  const st = p.keyStatus();
  assert.ok(Object.values(st).some((v: any) => v.state === "exhausted"));
});

test("全部 key 耗尽抛 QuotaExhausted", async () => {
  (globalThis as any).fetch = async () =>
    new Response("quota", { status: 429, headers: { "content-type": "text/plain" } });
  const p = makeAgnes(["k1"]);
  await assert.rejects(() => p.generate("text", "hi"), QuotaExhausted);
});
