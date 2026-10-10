/**
 * 通用 OpenAI 兼容插件（需求 1 的基石）。
 *
 * 绝大多数免费服务（Agnes、DeepSeek、OpenAI、兼容网关）的文本/图像接口都是
 * OpenAI 风格。本基类实现 TEXT 与 IMAGE 两种能力；新接入的免费服务只要：
 *
 *     register("myservice", class extends OpenAICompatiblePlugin {
 *       name = "myservice";
 *       modalities = ["text", "image"];   // 直接白嫖，无需重写 HTTP
 *     });
 *
 * 即可复用文本/图像能力；若需视频/音频等差异模态，再覆写 makeCapability。
 */

import { BasePlugin, Capability, register, type PluginCtor } from "../plugin.js";
import type { Modality } from "../types.js";
import type { ImageResult, TextResult } from "../results.js";

export class OpenAITextCapability extends Capability {
  modality: Modality = "text";
  async generate(prompt: string, opts: Record<string, any> = {}): Promise<TextResult> {
    const model = this.plugin.modelFor("text", opts.model);
    let messages = opts.messages;
    if (!messages) {
      const system = opts.system;
      messages = [];
      if (system) messages.push({ role: "system", content: system });
      messages.push({ role: "user", content: prompt });
    }
    const payload: any = { ...opts };
    delete payload.messages;
    delete payload.system;
    delete payload.model;
    payload.messages = messages;
    if (model) payload.model = model;

    const resp = await this.plugin.request("POST", "/chat/completions", { json: payload });
    const data = await resp.json();
    return { text: data.choices?.[0]?.message?.content ?? "", model, usage: data.usage ?? {}, raw: data };
  }
}

export class OpenAIImageCapability extends Capability {
  modality: Modality = "image";
  async generate(prompt: string, opts: Record<string, any> = {}): Promise<ImageResult> {
    const model = this.plugin.modelFor("image", opts.model);
    const payload: any = { ...opts };
    delete payload.model;
    payload.prompt = prompt;
    payload.n = opts.n ?? 1;
    payload.size = opts.size ?? "1024x1024";
    payload.response_format = opts.response_format ?? "url";
    if (model) payload.model = model;

    const resp = await this.plugin.request("POST", "/images/generations", { json: payload });
    const data = await resp.json();
    const urls: string[] = [];
    const b64: string[] = [];
    for (const item of data.data ?? []) {
      if (item.url) urls.push(item.url);
      if (item.b64_json) b64.push(item.b64_json);
    }
    return { urls, b64, model, raw: data };
  }
}

export class OpenAICompatiblePlugin extends BasePlugin {
  name = "openai-compatible";
  description = "OpenAI 兼容风格通用插件（文本/图像），可作为其它免费服务的基类";
  modalities = ["text", "image"] as Modality[];

  protected makeCapability(modality: Modality): Capability | null {
    if (modality === "text") return new OpenAITextCapability(this);
    if (modality === "image") return new OpenAIImageCapability(this);
    return null;
  }
}

register("openai-compatible", OpenAICompatiblePlugin as unknown as PluginCtor);
