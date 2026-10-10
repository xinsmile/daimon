/**
 * 配置模型（使用 Node 原生 API + yaml）。
 *
 * 配置来源优先级：
 *  1. 显式构造的 ProviderConfig / HarnessConfig 对象
 *  2. YAML / JSON 配置文件（见 config.example.yaml）
 *  3. 环境变量（apiKeyEnv 指向的变量，逗号分隔多个 key）
 *
 * 安全约定：密钥不写入仓库。示例仅保留 apiKeyEnv 变量名，真实 key 走环境变量。
 */

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { MODALITIES, type Modality } from "./types.js";

export class ProviderConfig {
  name: string;
  enabled: boolean;
  baseUrl: string;
  apiKeyEnv?: string;
  keys: string[];
  defaultModels: Partial<Record<Modality, string>>;
  extra: Record<string, any>;
  cooldownSeconds: number;
  roundRobin: boolean;
  maxFailures: number;
  stateFile?: string;

  constructor(init: {
    name: string;
    enabled?: boolean;
    baseUrl?: string;
    apiKeyEnv?: string;
    keys?: string[];
    defaultModels?: Partial<Record<Modality, string>>;
    extra?: Record<string, any>;
    cooldownSeconds?: number;
    roundRobin?: boolean;
    maxFailures?: number;
    stateFile?: string;
  }) {
    this.name = init.name;
    this.enabled = init.enabled ?? true;
    this.baseUrl = init.baseUrl ?? "";
    this.apiKeyEnv = init.apiKeyEnv;
    this.keys = init.keys ?? [];
    this.defaultModels = init.defaultModels ?? {};
    this.extra = init.extra ?? {};
    this.cooldownSeconds = init.cooldownSeconds ?? 60;
    this.roundRobin = init.roundRobin ?? false;
    this.maxFailures = init.maxFailures ?? 3;
    this.stateFile = init.stateFile;
  }

  /** 合并环境变量与内联 key，去重保序，过滤空串。 */
  resolveKeys(): string[] {
    const merged: string[] = [];
    if (this.apiKeyEnv) {
      const env = process.env[this.apiKeyEnv] ?? "";
      for (const k of env.split(",")) {
        const t = k.trim();
        if (t) merged.push(t);
      }
    }
    for (const k of this.keys) {
      const t = k.trim();
      if (t && !merged.includes(t)) merged.push(t);
    }
    return merged;
  }
}

export class HarnessConfig {
  defaultProvider?: string;
  logLevel: string;
  providers: Record<string, ProviderConfig>;

  constructor(init: { defaultProvider?: string; logLevel?: string; providers: Record<string, ProviderConfig> }) {
    this.defaultProvider = init.defaultProvider;
    this.logLevel = init.logLevel ?? "INFO";
    this.providers = init.providers;
  }

  effectiveProvider(): string {
    if (this.defaultProvider && this.providers[this.defaultProvider]) return this.defaultProvider;
    for (const [n, p] of Object.entries(this.providers)) if (p.enabled) return n;
    throw new Error("配置中没有可用（enabled）的 provider");
  }

  static fromFile(path: string): HarnessConfig {
    const raw = readFileSync(path, "utf-8");
    const isJson = path.endsWith(".json");
    const data: any = isJson ? JSON.parse(raw) : parseYaml(raw);
    const providers: Record<string, ProviderConfig> = {};
    for (const [name, pc] of Object.entries<any>(data?.providers ?? {})) {
      providers[name] = new ProviderConfig({ name, ...pc });
    }
    return new HarnessConfig({
      defaultProvider: data?.defaultProvider,
      logLevel: data?.logLevel ?? "INFO",
      providers,
    });
  }
}

// 让 TS 满意：MODALITIES 被引用以保证类型一致（防止误改模态集合）。
void MODALITIES;
