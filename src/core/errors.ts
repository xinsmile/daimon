/**
 * 异常体系。所有自定义异常继承 HarnessError，便于统一捕获。
 * 与密钥轮转相关的三类上游错误：
 *  - QuotaExhausted：免费额度/配额用尽 -> 标记当前 key 为 exhausted 并轮换
 *  - RateLimited  ：触发限流           -> 标记当前 key 进入 cooldown
 *  - ProviderError：其它上游错误        -> 计入失败次数，超限后标记 exhausted
 */

export class HarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class PluginNotFoundError extends HarnessError {
  constructor(public name: string) {
    super(`未注册或不可用的插件: ${name}`);
  }
}

export class CapabilityNotSupported extends HarnessError {
  constructor(public plugin: string, public modality: string) {
    super(`插件 ${plugin} 不支持模态 ${modality}`);
  }
}

export class NoHealthyKey extends HarnessError {
  constructor(public provider = "") {
    super(`provider=${provider} 已无可用 key（额度耗尽或均处于冷却）`);
  }
}

export class ProviderError extends HarnessError {
  status?: number;
  body: string;
  constructor(message: string, opts: { status?: number; body?: string } = {}) {
    super(message);
    this.status = opts.status;
    this.body = opts.body ?? "";
  }
}

export class QuotaExhausted extends ProviderError {}
export class RateLimited extends ProviderError {}
