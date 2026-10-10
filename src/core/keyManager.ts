/**
 * 密钥（API Key）池与自动轮转（对应需求 3）。
 *
 * 职责：
 * - 管理同一 provider 的多个 key；
 * - 免费额度耗尽（QuotaExhausted）时将该 key 标记为 exhausted 并切换到下一个；
 * - 触发限流（RateLimited）时让该 key 进入 cooldown，到期自动恢复；
 * - 连续多次其它失败也判定为失效，避免死循环刷坏 key；
 * - 可选将 key 状态持久化到本地文件（仅存哈希索引，绝不存明文）。
 *
 * Agnes 等 OpenAI 兼容服务在额度用尽时通常返回 429 + 含 quota/额度 字样的响应体；
 * 判定签名内置覆盖中英文，开箱即用。
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { NoHealthyKey } from "./errors.js";
import type { KeyState } from "./types.js";

interface Entry {
  state: KeyState;
  cooldownUntil: number; // ms 时间戳
  failCount: number;
  lastUsed: number;
}

export interface KeyManagerOptions {
  cooldownSeconds?: number;
  roundRobin?: boolean;
  maxFailures?: number;
  quotaSignatures?: string[];
  ratelimitSignatures?: string[];
  stateFile?: string;
}

const DEFAULT_QUOTA = ["quota", "exhausted", "insufficient", "额度", "余额", "免费额度", "credit", "out of", "用尽", "已用完"];
const DEFAULT_RATELIMIT = ["rate limit", "too many requests", "429", "请求过于频繁", "slow down", "throttl"];

function shortHash(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

export class KeyManager {
  private entries = new Map<string, Entry>();
  private rrIndex = 0;
  private cooldownSeconds: number;
  private roundRobin: boolean;
  private maxFailures: number;
  private stateFile?: string;

  constructor(keys: string[], opts: KeyManagerOptions = {}) {
    this.cooldownSeconds = opts.cooldownSeconds ?? 60;
    this.roundRobin = opts.roundRobin ?? false;
    this.maxFailures = opts.maxFailures ?? 3;
    this.stateFile = opts.stateFile;
    const now = Date.now();
    for (const k of keys) {
      this.entries.set(k, { state: "active", cooldownUntil: 0, failCount: 0, lastUsed: now });
    }
    this.loadState();
  }

  /** 返回一个当前可用的 key；无可用 key 时抛 NoHealthyKey。 */
  acquire(): string {
    const now = Date.now();
    const active: string[] = [];
    for (const [k, e] of this.entries) {
      if (e.state === "exhausted") continue;
      if (e.state === "cooldown" && now < e.cooldownUntil) continue;
      if (e.state === "cooldown") e.state = "active"; // 冷却刚好到期，恢复
      active.push(k);
    }
    if (active.length === 0) throw new NoHealthyKey();
    let chosen: string;
    if (this.roundRobin) {
      this.rrIndex = (this.rrIndex + 1) % active.length;
      chosen = active[this.rrIndex];
    } else {
      chosen = active[0];
    }
    this.entries.get(chosen)!.lastUsed = now;
    return chosen;
  }

  reportQuota(key: string): void {
    this.set(key, "exhausted");
  }

  reportRatelimit(key: string): void {
    this.cooldown(key, this.cooldownSeconds);
  }

  reportSuccess(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    e.failCount = 0;
    if (e.state === "cooldown" && Date.now() >= e.cooldownUntil) e.state = "active";
    this.persist();
  }

  reportFailure(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    e.failCount += 1;
    if (e.failCount >= this.maxFailures) {
      // 连续失败达到上限 -> 判定失效，触发轮换
      e.state = "exhausted";
      e.failCount = 0;
    }
    // 否则保持 active：交由插件在 maxAttempts 内做有限重试，避免单次瞬时错误就雪藏 key
    this.persist();
  }

  reset(key?: string): void {
    const targets = key ? [key] : [...this.entries.keys()];
    for (const k of targets) {
      const e = this.entries.get(k);
      if (e) {
        e.state = "active";
        e.cooldownUntil = 0;
        e.failCount = 0;
      }
    }
    this.persist();
  }

  status(): Record<string, { state: KeyState; failCount: number; cooldownRemaining: number }> {
    const now = Date.now();
    const out: Record<string, { state: KeyState; failCount: number; cooldownRemaining: number }> = {};
    for (const [k, e] of this.entries) {
      out[shortHash(k)] = {
        state: e.state,
        failCount: e.failCount,
        cooldownRemaining: Math.max(0, Math.round((e.cooldownUntil - now) / 1000)),
      };
    }
    return out;
  }

  get size(): number {
    return this.entries.size;
  }

  private cooldown(key: string, seconds: number): void {
    const e = this.entries.get(key);
    if (!e) return;
    e.state = "cooldown";
    e.cooldownUntil = Date.now() + seconds * 1000;
    this.persist();
  }

  private set(key: string, state: KeyState): void {
    const e = this.entries.get(key);
    if (!e) return;
    e.state = state;
    e.failCount = 0;
    this.persist();
  }

  private persist(): void {
    if (!this.stateFile) return;
    try {
      const payload: Record<string, { state: KeyState; cooldownUntil: number; failCount: number }> = {};
      for (const [k, e] of this.entries) {
        payload[shortHash(k)] = { state: e.state, cooldownUntil: e.cooldownUntil, failCount: e.failCount };
      }
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(this.stateFile, JSON.stringify(payload, null, 2));
    } catch {
      /* 持久化失败不应阻断主流程 */
    }
  }

  private loadState(): void {
    if (!this.stateFile) return;
    try {
      if (!fs.existsSync(this.stateFile)) return;
      const raw = JSON.parse(fs.readFileSync(this.stateFile, "utf-8")) as Record<
        string,
        { state: KeyState; cooldownUntil: number; failCount: number }
      >;
      for (const [k, e] of this.entries) {
        const s = raw[shortHash(k)];
        if (s) {
          e.state = s.state;
          e.cooldownUntil = s.cooldownUntil ?? 0;
          e.failCount = s.failCount ?? 0;
        }
      }
    } catch {
      /* ignore */
    }
  }
}
