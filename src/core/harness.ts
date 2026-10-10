/**
 * Harness 编排器：加载配置、装配插件、按 provider+模态 路由请求。
 */

import { HarnessConfig } from "../config.js";
import { buildPlugin } from "./plugin.js";
import type { BasePlugin } from "./plugin.js";
import "../plugins/index.js"; // 触发内置插件注册

export class Harness {
  config: HarnessConfig;
  plugins = new Map<string, BasePlugin>();

  constructor(config: HarnessConfig) {
    this.config = config;
    for (const [name, pc] of Object.entries(config.providers)) {
      if (!pc.enabled) continue;
      try {
        this.plugins.set(name, buildPlugin(name, pc));
      } catch (e) {
        console.warn(`provider ${name} 装配失败（已跳过）:`, (e as Error).message);
      }
    }
  }

  static fromFile(path: string): Harness {
    return new Harness(HarnessConfig.fromFile(path));
  }

  private resolveProvider(provider?: string): string {
    if (provider) {
      if (!this.plugins.has(provider)) throw new Error(`未启用或未知的 provider: ${provider}`);
      return provider;
    }
    const name = this.config.effectiveProvider();
    if (!this.plugins.has(name)) throw new Error(`默认 provider ${name} 装配失败，请检查配置/依赖`);
    return name;
  }

  async generate(provider: string | undefined, modality: string, prompt: string, opts?: Record<string, any>) {
    const name = this.resolveProvider(provider);
    return this.plugins.get(name)!.generate(modality, prompt, opts);
  }

  listProviders(): string[] {
    return [...this.plugins.keys()].sort();
  }

  providerInfo(provider?: string) {
    const name = this.resolveProvider(provider);
    const p = this.plugins.get(name)!;
    return {
      name: p.name,
      description: p.description,
      modalities: p.modalities,
      keyStatus: p.keyStatus(),
    };
  }
}
