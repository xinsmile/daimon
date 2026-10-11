import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderConfig } from "../src/capabilities/model/config.js";
import { buildPlugin } from "../src/capabilities/model/plugin.js";
import type { BasePlugin } from "../src/capabilities/model/plugin.js";
import "../src/capabilities/model/providers/index.js";

function makePollinations(): BasePlugin {
  const cfg = new ProviderConfig({
    name: "pollinations",
    keys: [], // 无需 key
    defaultModels: { text: "openai", image: "flux", audio: "openai-audio", video: "veo2" },
  });
  return buildPlugin("pollinations", cfg);
}

test("无需 key 也能装配，含全模态", () => {
  const p = makePollinations();
  const mods = new Set(p.modalities);
  for (const m of ["text", "image", "audio", "video"]) assert.ok(mods.has(m as any), `缺少模态 ${m}`);
});

test("文本经 /openai OpenAI 兼容端点", async () => {
  let url = "";
  let body: any;
  (globalThis as any).fetch = async (u: any, init: any) => {
    url = String(u);
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "hi there" } }], usage: { total_tokens: 2 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const p = makePollinations();
  const res: any = await p.generate("text", "hello");
  assert.equal(res.text, "hi there");
  assert.equal(res.usage.total_tokens, 2);
  assert.ok(url.includes("text.pollinations.ai/openai"));
  assert.equal(body.model, "openai");
  assert.equal(body.messages[0].content, "hello");
});

test("图像经 GET image.pollinations.ai/prompt 返回字节", async () => {
  let url = "";
  (globalThis as any).fetch = async (u: any) => {
    url = String(u);
    return new Response(new Uint8Array([9, 8, 7]), { status: 200, headers: { "content-type": "image/jpeg" } });
  };
  const p = makePollinations();
  const res: any = await p.generate("image", "a cat", { width: 512, height: 256 });
  assert.ok(res.data instanceof Uint8Array);
  assert.equal(res.data.length, 3);
  assert.equal(res.format, "image/jpeg");
  assert.ok(url.includes("image.pollinations.ai/prompt/"));
  assert.ok(url.includes("model=flux"));
  assert.ok(url.includes("nologo=true"));
});

test("音频经 GET text.pollinations.ai?model=openai-audio", async () => {
  let url = "";
  (globalThis as any).fetch = async (u: any) =>
    new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } });
  // 先抓取 URL
  (globalThis as any).fetch = async (u: any) => {
    url = String(u);
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } });
  };
  const p = makePollinations();
  const res: any = await p.generate("audio", "speak this");
  assert.ok(res.data instanceof Uint8Array);
  assert.ok(url.includes("text.pollinations.ai/"));
  assert.ok(url.includes("model=openai-audio"));
});

test("视频经 POST video 端点返回 URL", async () => {
  let url = "";
  let body: any;
  (globalThis as any).fetch = async (u: any, init: any) => {
    url = String(u);
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ url: "https://v.pollinations.ai/x.mp4" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const p = makePollinations();
  const res: any = await p.generate("video", "explosion");
  assert.equal(res.url, "https://v.pollinations.ai/x.mp4");
  assert.ok(url.includes("video.pollinations.ai/v1/video"));
  assert.equal(body.model, "veo2");
});

test("上游错误抛 ProviderError", async () => {
  const { ProviderError } = await import("../src/capabilities/model/errors.js");
  (globalThis as any).fetch = async () => new Response("boom", { status: 500, headers: { "content-type": "text/plain" } });
  const p = makePollinations();
  await assert.rejects(() => p.generate("text", "x"), ProviderError);
});
