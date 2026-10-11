import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderConfig } from "../src/capabilities/model/config.js";
import { buildPlugin } from "../src/capabilities/model/plugin.js";
import type { BasePlugin } from "../src/capabilities/model/plugin.js";
import "../src/capabilities/model/providers/index.js";

interface Spec {
  key: string;
  baseUrl: string;
  apiKeyEnv: string;
  model: string;
}

// 全部为 OpenAI 兼容的免费 / 免费额度服务，零代码复用 openai-compatible 基类。
const PROVIDERS: Spec[] = [
  { key: "zhipu", baseUrl: "https://open.bigmodel.cn/api/paas/v4/", apiKeyEnv: "ZHIPU_API_KEYS", model: "glm-4-flash" },
  { key: "siliconflow", baseUrl: "https://api.siliconflow.cn/v1", apiKeyEnv: "SILICONFLOW_API_KEYS", model: "Qwen/Qwen2.5-7B-Instruct" },
  { key: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEYS", model: "meta-llama/llama-3.1-8b-instruct:free" },
  { key: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEYS", model: "llama-3.1-8b-instant" },
  { key: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", apiKeyEnv: "GEMINI_API_KEYS", model: "gemini-2.0-flash" },
  { key: "qianfan", baseUrl: "https://qianfan.baidubce.com/v2", apiKeyEnv: "QIANFAN_API_KEYS", model: "ernie-4.0-8k-latest" },
  { key: "bailian", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKeyEnv: "DASHSCOPE_API_KEYS", model: "qwen-plus" },
];

function makeOpenAICompatible(spec: Spec): BasePlugin {
  const cfg = new ProviderConfig({
    name: spec.key,
    plugin: "openai-compatible", // 关键：复用基类，与 YAML key 解耦
    baseUrl: spec.baseUrl,
    apiKeyEnv: spec.apiKeyEnv,
    keys: ["test-key"],
    defaultModels: { text: spec.model },
  });
  return buildPlugin(spec.key, cfg);
}

for (const spec of PROVIDERS) {
  test(`${spec.key} 经 openai-compatible 基类解析并暴露自身身份`, () => {
    const p = makeOpenAICompatible(spec);
    assert.equal(p.name, spec.key); // 不是 "openai-compatible"
    const mods = new Set(p.modalities);
    assert.ok(mods.has("text"), "缺少 text");
    assert.ok(mods.has("image"), "缺少 image");
  });

  test(`${spec.key} 文本生成命中正确 host 与鉴权头`, async () => {
    let url = "";
    let auth = "";
    let body: any;
    (globalThis as any).fetch = async (u: any, init: any) => {
      url = String(u);
      auth = init.headers["Authorization"];
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: `ok-${spec.key}` } }], usage: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const p = makeOpenAICompatible(spec);
    const res: any = await p.generate("text", "hi");
    assert.equal(res.text, `ok-${spec.key}`);
    assert.ok(url.startsWith(spec.baseUrl), `应命中 ${spec.baseUrl}，实际 ${url}`);
    assert.equal(auth, "Bearer test-key");
    assert.equal(body.model, spec.model);
  });
}
