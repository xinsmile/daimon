/**
 * Agnes AI 插件（需求 2）。
 *
 * 官方资料（https://www.agnes-ai.cn/zh-Hans/docs/overview）：
 *  - Base URL: https://api.agnes-ai.cn/v1
 *  - 认证: Authorization: Bearer <key>
 *  - 接口风格: OpenAI 兼容（文本/图像可直接复用基类）
 *  - 能力: 文本 / 图像 / 视频 / 音视频同步 / 多模态
 *
 * 本插件：
 *  - 文本、图像 直接继承 OpenAICompatiblePlugin（零重复代码）；
 *  - 视频: 异步「提交 + 轮询」模式（免费视频模型 agnes-video-new-flash）；
 *  - 音频: TTS（/audio/speech，OpenAI 风格）；
 *  - 多模态: 图文混合对话（vision chat）。
 *
 * ⚠️ 需按目标版本核实：文档站当前仅公开 overview，视频/音频的**具体端点路径与
 * 响应字段**以 Agnes 控制台/官方文档为准。相关端点已抽到 config.extra，可直接改
 * 配置而无需改代码。免费模型名已按既有项目经验预填（见 config.example.yaml）。
 */

import { writeFileSync } from "node:fs";
import { BasePlugin, Capability, register, type PluginCtor } from "../core/plugin.js";
import type { Modality } from "../core/types.js";
import type { AudioResult, MultimodalResult, VideoResult } from "../core/results.js";
import { OpenAICompatiblePlugin } from "./openaiCompatible.js";

function extractUrl(data: any): string | null {
  if (!data || typeof data !== "object") return null;
  for (const k of ["url", "video_url", "result", "output", "download_url"]) {
    const v = data[k];
    if (typeof v === "string" && v.startsWith("http")) return v;
    if (v && typeof v === "object") {
      for (const s of ["url", "video_url", "download_url"]) {
        if (typeof v[s] === "string" && v[s].startsWith("http")) return v[s];
      }
    }
  }
  const nested = data.data;
  if (Array.isArray(nested) && nested.length) return extractUrl(nested[0]);
  return null;
}

function extractTaskId(data: any): string | null {
  if (!data || typeof data !== "object") return null;
  for (const k of ["id", "task_id", "taskId", "generation_id", "video_id"]) {
    const v = data[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

export class AgnesVideoCapability extends Capability {
  modality: Modality = "video";
  async generate(prompt: string, opts: Record<string, any> = {}): Promise<VideoResult> {
    const model = this.plugin.modelFor("video", opts.model);
    const submitPath = this.plugin.config.extra?.videoEndpoint ?? "/videos/generations";
    const pollTpl = this.plugin.config.extra?.videoPollEndpoint ?? "/videos/{id}";

    const payload: any = { ...opts };
    delete payload.model;
    payload.prompt = prompt;
    payload.duration = opts.duration ?? 5;
    if (model) payload.model = model;

    const submit = await this.plugin.request("POST", submitPath, { json: payload, timeout: 120_000 });
    const submitData = await submit.json();

    const direct = extractUrl(submitData);
    if (direct) return { url: direct, status: "succeeded", model, raw: submitData };

    const taskId = extractTaskId(submitData);
    if (!taskId) return { url: null, status: "unknown", model, raw: submitData };

    const pollPath = pollTpl.replace("{id}", taskId);
    const timeoutSec = Number(this.plugin.config.extra?.videoTimeout ?? 600);
    const interval = Number(this.plugin.config.extra?.videoPollInterval ?? 5);
    const deadline = Date.now() + timeoutSec * 1000;

    while (Date.now() < deadline) {
      const poll = await this.plugin.request("GET", pollPath, { timeout: 60_000 });
      const pdata = await poll.json();
      const status = String(pdata.status ?? pdata.state ?? "").toLowerCase();
      if (["succeeded", "completed", "success"].includes(status))
        return { url: extractUrl(pdata), status: "succeeded", model, raw: pdata };
      if (["failed", "error"].includes(status))
        return { url: null, status: "failed", model, raw: pdata };
      await new Promise((r) => setTimeout(r, interval * 1000));
    }
    return { url: null, status: "timeout", model, raw: submitData };
  }
}

export class AgnesAudioCapability extends Capability {
  modality: Modality = "audio";
  async generate(prompt: string, opts: Record<string, any> = {}): Promise<AudioResult> {
    const model = this.plugin.modelFor("audio", opts.model);
    const endpoint = this.plugin.config.extra?.audioEndpoint ?? "/audio/speech";
    const payload: any = { ...opts };
    delete payload.model;
    payload.input = prompt;
    payload.voice = opts.voice ?? "default";
    payload.response_format = opts.response_format ?? "mp3";
    if (model) payload.model = model;

    const resp = await this.plugin.request("POST", endpoint, { json: payload, timeout: 300_000 });
    const data = new Uint8Array(await resp.arrayBuffer());
    let path: string | null = null;
    if (opts.output) {
      writeFileSync(opts.output, data);
      path = opts.output;
    }
    return { data, format: payload.response_format ?? "mp3", model, path };
  }
}

export class AgnesMultimodalCapability extends Capability {
  modality: Modality = "multimodal";
  async generate(prompt: string, opts: Record<string, any> = {}): Promise<MultimodalResult> {
    const model = this.plugin.modelFor("multimodal", opts.model);
    const images: string[] = opts.images ?? [];
    const content: any[] = [{ type: "text", text: prompt }];
    for (const img of images) content.push({ type: "image_url", image_url: { url: img } });

    const payload: any = { ...opts };
    delete payload.model;
    delete payload.images;
    payload.messages = [{ role: "user", content }];
    if (model) payload.model = model;

    const resp = await this.plugin.request("POST", "/chat/completions", { json: payload });
    const data = await resp.json();
    return { text: data.choices?.[0]?.message?.content ?? "", model, usage: data.usage ?? {}, raw: data };
  }
}

export class AgnesPlugin extends OpenAICompatiblePlugin {
  name = "agnes";
  description = "Agnes AI 多模态免费服务（文本/图像/视频/音频/多模态），OpenAI 兼容";
  modalities = ["text", "image", "video", "audio", "multimodal"] as Modality[];

  protected makeCapability(modality: Modality): Capability | null {
    if (modality === "video") return new AgnesVideoCapability(this);
    if (modality === "audio") return new AgnesAudioCapability(this);
    if (modality === "multimodal") return new AgnesMultimodalCapability(this);
    return super.makeCapability(modality);
  }
}

register("agnes", AgnesPlugin as unknown as PluginCtor);
