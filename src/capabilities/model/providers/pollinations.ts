/**
 * Pollinations.AI 插件 —— 完全免费、无需 API Key 的全模态生成服务。
 *
 * 官方 API（2025 验证；详见 https://github.com/pollinations/pollinations）：
 *  - 文本: POST https://text.pollinations.ai/openai  (OpenAI 兼容 chat 格式)
 *          或 GET  https://text.pollinations.ai/{prompt}?model=...
 *  - 图像: GET  https://image.pollinations.ai/prompt/{prompt}?model=flux&width=&height=&seed=&nologo=true
 *  - 音频: GET  https://text.pollinations.ai/{prompt}?model=openai-audio&voice=nova
 *  - 视频: POST https://video.pollinations.ai/v1/video  (返回视频 URL；端点演进较快，可在 extra 调整)
 *
 * 该服务零密钥、不走 Bearer 鉴权，因此本插件**不依赖 KeyManager / this.request()**，
 * 而是直接调用 globalThis.fetch（测试中同样可整体 mock）。这恰好印证了「其他免费服务
 * 以极少改动接入」的设计目标：即便差异极大的接口，也只是新增一个插件类而已。
 */

import { writeFileSync } from "node:fs";
import { BasePlugin, Capability, register, type PluginCtor } from "../plugin.js";
import { ProviderError } from "../errors.js";
import type { Modality } from "../types.js";
import type { AudioResult, ImageResult, TextResult, VideoResult } from "../results.js";

const TEXT_BASE = "https://text.pollinations.ai";
const IMAGE_BASE = "https://image.pollinations.ai";
const VIDEO_BASE = "https://video.pollinations.ai";

async function unchecked(url: string, init?: RequestInit): Promise<Response> {
  let resp: Response;
  try {
    resp = await fetch(url, init);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProviderError(`传输层错误: ${msg}`, { status: undefined, body: "" });
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new ProviderError(`Pollinations 上游错误 (HTTP ${resp.status}): ${body.slice(0, 200)}`, {
      status: resp.status,
      body,
    });
  }
  return resp;
}

export class PollinationsTextCapability extends Capability {
  modality: Modality = "text";
  async generate(prompt: string, opts: Record<string, any> = {}): Promise<TextResult> {
    const model = this.plugin.modelFor("text", opts.model) || "openai";
    const messages = opts.messages ?? [{ role: "user", content: prompt }];
    const payload: any = { ...opts };
    delete payload.messages;
    delete payload.model;
    payload.model = model;
    payload.messages = messages;

    const resp = await unchecked(`${TEXT_BASE}/openai`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      model,
      usage: data.usage ?? {},
      raw: data,
    };
  }
}

export class PollinationsImageCapability extends Capability {
  modality: Modality = "image";
  async generate(prompt: string, opts: Record<string, any> = {}): Promise<ImageResult> {
    const model = this.plugin.modelFor("image", opts.model) || "flux";
    const width = Number(opts.width ?? 1024);
    const height = Number(opts.height ?? 1024);
    const seed = Number(opts.seed ?? Math.floor(Math.random() * 1_000_000_000));
    const p = new URLSearchParams({ model, width: String(width), height: String(height), seed: String(seed) });
    if (opts.nologo !== false) p.set("nologo", "true");
    if (opts.private) p.set("private", "true");
    if (opts.enhance) p.set("enhance", "true");

    const url = `${IMAGE_BASE}/prompt/${encodeURIComponent(prompt)}?${p.toString()}`;
    const resp = await unchecked(url);
    const buf = new Uint8Array(await resp.arrayBuffer());
    const format = resp.headers.get("content-type") || "image/jpeg";
    let path: string | null = null;
    if (opts.output) {
      writeFileSync(opts.output, buf);
      path = opts.output;
    }
    return { urls: [], b64: [], data: buf, format, model, raw: buf };
  }
}

export class PollinationsAudioCapability extends Capability {
  modality: Modality = "audio";
  async generate(prompt: string, opts: Record<string, any> = {}): Promise<AudioResult> {
    const model = this.plugin.modelFor("audio", opts.model) || "openai-audio";
    const voice = opts.voice ?? "nova";
    const url = `${TEXT_BASE}/${encodeURIComponent(prompt)}?model=${encodeURIComponent(
      model,
    )}&voice=${encodeURIComponent(voice)}`;
    const resp = await unchecked(url);
    const buf = new Uint8Array(await resp.arrayBuffer());
    let path: string | null = null;
    if (opts.output) {
      writeFileSync(opts.output, buf);
      path = opts.output;
    }
    return { data: buf, format: "mp3", model, path };
  }
}

export class PollinationsVideoCapability extends Capability {
  modality: Modality = "video";
  async generate(prompt: string, opts: Record<string, any> = {}): Promise<VideoResult> {
    const model = this.plugin.modelFor("video", opts.model) || "veo2";
    const endpoint =
      this.plugin.config.extra?.videoEndpoint ?? `${VIDEO_BASE}/v1/video`;
    const payload: any = { ...opts };
    delete payload.model;
    payload.model = model;
    payload.prompt = prompt;

    const resp = await unchecked(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    const url: string | null =
      data.url ?? data.video_url ?? data.result ?? (Array.isArray(data.data) ? data.data[0]?.url : null);
    return { url: url ?? null, status: "succeeded", model, raw: data };
  }
}

export class PollinationsPlugin extends BasePlugin {
  name = "pollinations";
  description = "Pollinations.AI 全模态免费服务（文本/图像/音频/视频），无需 API Key";
  modalities = ["text", "image", "audio", "video"] as Modality[];

  protected makeCapability(modality: Modality): Capability | null {
    if (modality === "text") return new PollinationsTextCapability(this);
    if (modality === "image") return new PollinationsImageCapability(this);
    if (modality === "audio") return new PollinationsAudioCapability(this);
    if (modality === "video") return new PollinationsVideoCapability(this);
    return null;
  }
}

register("pollinations", PollinationsPlugin as unknown as PluginCtor);
