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
  /** 复用已注册插件类名（与配置 key 解耦，支持多 provider 共用基类） */
  plugin?: string;

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
    plugin?: string;
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
    this.plugin = init.plugin;
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
      // 配置约定用 snake_case（base_url / api_key_env / default_models / extra.video_endpoint …），
      // 这里整体转 camelCase，保证与 ProviderConfig 字段与插件读取（config.extra.videoEndpoint）一致。
      providers[name] = new ProviderConfig({ name, ...deepCamelKeys(pc) });
    }
    return new HarnessConfig({
      defaultProvider: data?.defaultProvider ?? data?.default_provider,
      logLevel: data?.logLevel ?? data?.log_level ?? "INFO",
      providers,
    });
  }
}

/** 递归把对象键从 snake_case 转为 camelCase（只改键名，不动值）。 */
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}
function deepCamelKeys(value: any): any {
  if (Array.isArray(value)) return value.map(deepCamelKeys);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[snakeToCamel(k)] = deepCamelKeys(v);
    return out;
  }
  return value;
}

// 让 TS 满意：MODALITIES 被引用以保证类型一致（防止误改模态集合）。
void MODALITIES;
