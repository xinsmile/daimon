/**
 * 核心类型：模态、密钥状态、解析辅助。
 * 采用字符串字面量联合类型（而非 enum），以兼容 Node 的原生 TS 运行（--experimental-strip-types）。
 */

export type Modality = "text" | "image" | "audio" | "video" | "multimodal";

export const MODALITIES: Modality[] = ["text", "image", "audio", "video", "multimodal"];

export type KeyState = "active" | "exhausted" | "cooldown";

export function parseModality(value: string): Modality {
  const v = value.toLowerCase();
  if ((MODALITIES as string[]).includes(v)) return v as Modality;
  throw new Error(`未知模态 ${value}，可选: ${MODALITIES.join(", ")}`);
}
