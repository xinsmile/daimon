/**
 * 插件系统核心：能力抽象、插件基类、注册表（对应需求 1）。
 *
 * 设计目标（让其它免费服务以极少改动接入）：
 * - 能力（Capability）按模态（Modality）划分：文本/图像/音频/视频/多模态；
 * - 新服务只需：(a) 写一个继承 BasePlugin 的类并在模块底部 register()；
 *   (b) 复用 OpenAICompatiblePlugin 基类即可白嫖文本/图像能力；
 *   (c) 仅对视频/音频等差异模态实现各自 Capability；
 * - 密钥轮转对插件透明：插件只需调用 this.request(...)，内部自动跨 key 重试。
 */

import {
  CapabilityNotSupported,
  NoHealthyKey,
  PluginNotFoundError,
  ProviderError,
  QuotaExhausted,
  RateLimited,
} from "./errors.js";
import { request } from "./http.js";
import { KeyManager } from "./keyManager.js";
import type { ProviderConfig } from "./config.js";
import { parseModality, type Modality } from "./types.js";

export type PluginCtor = new (config: ProviderConfig) => BasePlugin;

const REGISTRY = new Map<string, PluginCtor>();

/** 注册一个插件类。通常在插件模块底部调用。 */
export function register(name: string, ctor: PluginCtor): void {
  REGISTRY.set(name, ctor);
}

export function getPluginClass(name: string): PluginCtor {
  const c = REGISTRY.get(name);
  if (!c) throw new PluginNotFoundError(name);
  return c;
}

export function listPlugins(): string[] {
  return [...REGISTRY.keys()].sort();
}

export function buildPlugin(name: string, config: ProviderConfig): BasePlugin {
  const Ctor = getPluginClass(name);
  return new Ctor(config);
}

/** 单一模态的生成能力。插件为每个支持的模态装配一个 Capability 实例。 */
export abstract class Capability {
  abstract modality: Modality;
  constructor(protected plugin: BasePlugin) {}
  abstract generate(prompt: string, opts?: Record<string, any>): Promise<unknown>;
}

/** 所有 provider 插件的基类。 */
export abstract class BasePlugin {
  abstract name: string;
  abstract description: string;
  abstract modalities: Modality[];
  config: ProviderConfig;
  keys: KeyManager;
  private caps = new Map<Modality, Capability>();
  private capsBuilt = false;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.keys = new KeyManager(config.resolveKeys(), {
      cooldownSeconds: config.cooldownSeconds,
      roundRobin: config.roundRobin,
      maxFailures: config.maxFailures,
      stateFile: config.stateFile,
    });
  }

  /** 能力装配推迟到首次使用时（避免子类字段在 super() 阶段尚未初始化的时序问题）。 */
  private ensureCapabilities(): void {
    if (this.capsBuilt) return;
    this.buildCapabilities();
    this.capsBuilt = true;
  }

  protected buildCapabilities(): void {
    for (const m of this.modalities) {
      const cap = this.makeCapability(m);
      if (cap) this.caps.set(m, cap);
    }
  }

  // 默认不提供任何能力；子类据此返回具体 Capability（或复用 super）。
  protected makeCapability(_modality: Modality): Capability | null {
    return null;
  }

  getCapability(modality: Modality | string): Capability {
    this.ensureCapabilities();
    const m = typeof modality === "string" ? parseModality(modality) : modality;
    const cap = this.caps.get(m);
    if (!cap) throw new CapabilityNotSupported(this.name, m);
    return cap;
  }

  async generate(modality: Modality | string, prompt: string, opts?: Record<string, any>): Promise<unknown> {
    this.ensureCapabilities();
    return this.getCapability(modality).generate(prompt, opts);
  }

  /** 拼接完整 URL。 */
  protected url(path: string): string {
    const base = (this.config.baseUrl ?? "").replace(/\/$/, "");
    return base + (path.startsWith("/") ? path : "/" + path);
  }

  /** 带密钥轮转的 HTTP 调用。
   *  - QuotaExhausted -> 当前 key 标记 exhausted，换下一个；
   *  - RateLimited / 其它 ProviderError -> 计入失败/冷却，换下一个；
   *  - 全部 key 不可用 -> 抛出最后一个错误或 NoHealthyKey。
   */
  async request(
    method: string,
    path: string,
    opts: { json?: unknown; headers?: Record<string, string>; timeout?: number } = {},
  ): Promise<Response> {
    let lastErr: Error | null = null;
    const maxAttempts = Math.max(1, this.keys.size) * 2 + 1;
    let attempts = 0;
    while (attempts < maxAttempts) {
      let key: string;
      try {
        key = this.keys.acquire();
      } catch (e) {
        if (e instanceof NoHealthyKey) break;
        throw e;
      }
      const headers: Record<string, string> = { ...(opts.headers ?? {}) };
      headers["Authorization"] = `Bearer ${key}`;
      if (opts.json !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
      try {
        const resp = await request(method, this.url(path), { ...opts, headers });
        this.keys.reportSuccess(key);
        return resp;
      } catch (err) {
        if (err instanceof QuotaExhausted) {
          this.keys.reportQuota(key);
          lastErr = err;
        } else if (err instanceof RateLimited) {
          this.keys.reportRatelimit(key);
          lastErr = err;
        } else if (err instanceof ProviderError) {
          this.keys.reportFailure(key);
          lastErr = err;
        } else {
          throw err;
        }
      }
      attempts++;
    }
    if (lastErr) throw lastErr;
    throw new NoHealthyKey(this.name);
  }

  modelFor(modality: Modality | string, override?: string): string {
    if (override) return override;
    const key = modality as string;
    return this.config.defaultModels?.[key as Modality] ?? "";
  }

  keyStatus(): ReturnType<KeyManager["status"]> {
    return this.keys.status();
  }
}
