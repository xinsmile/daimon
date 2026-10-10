/**
 * ModelService —— 把「免费模型接入 + 多 Key 轮转」包装成 cordis 能力。
 *
 * 这是 daimon 的一个 capability：对外统一暴露 generate()，内部复用已有的
 * Harness / KeyManager / provider 插件体系（BasePlugin + Capability + REGISTRY）。
 * 即：cordis 管「能力」，model 能力内部管「模型 provider」，与上游 deepseek-harness
 * 「cordis 管包、llm 包管 provider」的两层结构一致。
 */

import { Service, type Context } from "cordis";
import { Harness } from "./harness.js";
import { HarnessConfig, ProviderConfig } from "./config.js";
import type { Modality } from "./types.js";

export interface ModelConfig {
  /** 直接给配置文件路径（YAML/JSON），优先于内联 providers */
  configFile?: string;
  defaultProvider?: string;
  providers?: Record<string, Record<string, any>>;
}

export class ModelService extends Service {
  readonly harness: Harness;

  constructor(ctx: Context, config: ModelConfig = {}) {
    super(ctx, "model");
    const hc = config.configFile
      ? HarnessConfig.fromFile(config.configFile)
      : new HarnessConfig({
          defaultProvider: config.defaultProvider,
          providers: Object.fromEntries(
            Object.entries(config.providers ?? {}).map(([name, raw]) => [
              name,
              raw instanceof ProviderConfig ? raw : new ProviderConfig({ name, ...raw }),
            ]),
          ),
        });
    this.harness = new Harness(hc);
  }

  /** 通用生成入口：按 modality 路由到对应 provider 能力 */
  async generate(
    modality: Modality | string,
    prompt: string,
    opts?: { provider?: string } & Record<string, any>,
  ) {
    return this.harness.generate(opts?.provider, String(modality), prompt, opts);
  }

  /** 便捷：文本生成 */
  async text(prompt: string, opts?: { provider?: string } & Record<string, any>) {
    return this.generate("text", prompt, opts);
  }

  /** 已装配的 provider 列表 */
  listProviders(): string[] {
    return this.harness.listProviders();
  }

  /** provider 详情（含 key 健康状态） */
  providerInfo(provider?: string) {
    return this.harness.providerInfo(provider);
  }
}

export default ModelService;
