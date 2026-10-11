import { test } from "node:test";
import assert from "node:assert/strict";
import { CapabilityNotSupported, PluginNotFoundError } from "../src/capabilities/model/errors.js";
import { ProviderConfig } from "../src/capabilities/model/config.js";
import { buildPlugin, getPluginClass, listPlugins } from "../src/capabilities/model/plugin.js";
import "../src/capabilities/model/providers/index.js";

test("内置插件已注册", () => {
  const names = listPlugins();
  assert.ok(names.includes("agnes"));
  assert.ok(names.includes("openai-compatible"));
  assert.ok(names.includes("edge-tts"));
  assert.ok(names.includes("pollinations"));
});

test("plugin 字段可让命名 provider 复用基类并暴露自身身份", () => {
  const cfg = new ProviderConfig({
    name: "zhipu",
    plugin: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/",
    keys: ["k"],
  });
  const p = buildPlugin("zhipu", cfg);
  assert.equal(p.name, "zhipu");
  assert.equal(p.getCapability("text").modality, "text");
});

test("构建 agnes 插件含全部模态", () => {
  const cfg = new ProviderConfig({
    name: "agnes",
    baseUrl: "https://api.agnes-ai.cn/v1",
    keys: ["dummy"],
    defaultModels: { text: "t", image: "i", video: "v", audio: "a", multimodal: "t" },
  });
  const p = buildPlugin("agnes", cfg);
  const mods = new Set(p.modalities);
  for (const m of ["text", "image", "video", "audio", "multimodal"]) assert.ok(mods.has(m as any), `缺少模态 ${m}`);
});

test("能力路由与不支持模态", () => {
  const cfg = new ProviderConfig({ name: "oc", baseUrl: "x", keys: ["k"] });
  const oc = buildPlugin("openai-compatible", cfg);
  assert.equal(oc.getCapability("text").modality, "text");
  assert.throws(() => oc.getCapability("video"), CapabilityNotSupported);
});

test("未知插件抛错", () => {
  assert.throws(() => getPluginClass("nope"), PluginNotFoundError);
});
