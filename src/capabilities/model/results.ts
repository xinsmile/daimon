/** 统一的结果对象。各 Capability 返回对应结果类型，便于调用方结构化消费。 */

export interface TextResult {
  text: string;
  model: string;
  usage: Record<string, unknown>;
  raw: unknown;
}

export interface ImageResult {
  urls: string[];
  b64: string[];
  model: string;
  raw: unknown;
  /** 二进制图片数据（如 Pollinations 直接返回字节时填充） */
  data?: Uint8Array;
  /** 内容类型，如 image/jpeg */
  format?: string;
}

export interface AudioResult {
  data: Uint8Array;
  format: string;
  model: string;
  path?: string | null;
}

export interface VideoResult {
  url: string | null;
  status: string;
  model: string;
  raw: unknown;
}

export interface MultimodalResult {
  text: string;
  model: string;
  usage: Record<string, unknown>;
  raw: unknown;
}
