/**
 * edge-tts 免费 TTS 插件（演示需求 1：零密钥免费服务也能极简接入）。
 *
 * edge-tts 由微软提供、完全免费、无需 API Key，是本项目早期选定的免费配音方案。
 * 它不走 HTTP Key 体系，因此本插件：
 *  - 不依赖 KeyManager（构造时 keys 为空，generate 也不调用 this.request）；
 *  - 仅实现 AUDIO 单一模态；
 *  - 缺失 edge-tts 依赖时，插件仍会注册成功，仅在真正调用时才报“请先安装”。
 *
 * 对照“最小化接入成本”：只需一个继承 BasePlugin 的类 + 一个 Capability 方法，
 * 无需关心密钥轮转/HTTP 封装，印证了插件系统的可扩展性。
 */

import { writeFileSync } from "node:fs";
import { BasePlugin, Capability, register, type PluginCtor } from "../core/plugin.js";
import type { Modality } from "../core/types.js";
import type { AudioResult } from "../core/results.js";

export class EdgeTTSPlugin extends BasePlugin {
  name = "edge-tts";
  description = "微软 edge-tts 免费语音合成（无需 API Key，仅支持 AUDIO）";
  modalities = ["audio"] as Modality[];

  protected makeCapability(modality: Modality): Capability | null {
    if (modality === "audio") return new EdgeTTSCapability(this);
    return null;
  }
}

export class EdgeTTSCapability extends Capability {
  modality: Modality = "audio";
  async generate(prompt: string, opts: Record<string, any> = {}): Promise<AudioResult> {
    // 延迟导入：缺失依赖时不影响其它插件
    // @ts-ignore 可选依赖，无类型声明
    const edgeTts: any = await import("edge-tts").catch(() => {
      throw new Error("未安装 edge-tts，请先 `npm i edge-tts`");
    });
    const voice = opts.voice ?? this.plugin.config.defaultModels?.audio ?? "zh-CN-XiaoxiaoNeural";
    const communicate = new edgeTts.Communicate(prompt, voice);
    const chunks: Uint8Array[] = [];
    for await (const chunk of communicate.stream()) {
      if (chunk.type === "audio") chunks.push(new Uint8Array(chunk.data as ArrayBuffer));
    }
    let total = 0;
    for (const c of chunks) total += c.length;
    const data = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      data.set(c, off);
      off += c.length;
    }
    let path: string | null = null;
    if (opts.output) {
      writeFileSync(opts.output, data);
      path = opts.output;
    }
    return { data, format: "mp3", model: voice, path };
  }
}

register("edge-tts", EdgeTTSPlugin as unknown as PluginCtor);
