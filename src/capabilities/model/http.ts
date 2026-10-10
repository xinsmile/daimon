/**
 * 异步 HTTP 封装（基于 Node 原生 fetch）。
 * - 统一超时与异常分类；
 * - 将上游 4xx/5xx 转为 Harness 异常（QuotaExhausted / RateLimited / ProviderError）；
 * - 真正的网络调用集中在 request()，便于在测试中整体 mock（替换 globalThis.fetch）。
 */

import { ProviderError, QuotaExhausted, RateLimited } from "./errors.js";

const DEFAULT_TIMEOUT = 120_000;
const QUOTA_CODES = new Set([402, 429]);

function classify(status: number, body: string): "quota" | "ratelimit" | "error" {
  const bt = body.toLowerCase();
  if (QUOTA_CODES.has(status)) {
    const quotaKw = ["quota", "exhausted", "insufficient", "额度", "余额", "免费额度", "credit", "out of", "用尽", "已用完"];
    if (quotaKw.some((k) => bt.includes(k))) return "quota";
    return "ratelimit";
  }
  if (status === 400) {
    const quotaKw = ["quota", "额度", "余额", "免费额度", "credit", "用尽"];
    if (quotaKw.some((k) => bt.includes(k))) return "quota";
  }
  return "error";
}

export interface RequestOptions {
  json?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
}

export async function request(
  method: string,
  url: string,
  opts: RequestOptions = {},
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? DEFAULT_TIMEOUT);
  try {
    const resp = await fetch(url, {
      method,
      headers: opts.headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      const kind = classify(resp.status, body);
      if (kind === "quota")
        throw new QuotaExhausted(`额度耗尽 (HTTP ${resp.status}): ${body.slice(0, 200)}`, {
          status: resp.status,
          body,
        });
      if (kind === "ratelimit")
        throw new RateLimited(`触发限流 (HTTP ${resp.status}): ${body.slice(0, 200)}`, {
          status: resp.status,
          body,
        });
      throw new ProviderError(`上游错误 (HTTP ${resp.status}): ${body.slice(0, 200)}`, {
        status: resp.status,
        body,
      });
    }
    return resp;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProviderError(`传输层错误: ${msg}`, { status: undefined, body: "" });
  } finally {
    clearTimeout(timer);
  }
}
