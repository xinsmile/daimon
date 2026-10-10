/**
 * SessionService —— 会话持久化能力（daimon capability）。
 * 维护多轮消息历史，落盘到本地 JSON，支持断点续聊。
 */

import { Service, type Context } from "cordis";
import * as fs from "node:fs";
import * as path from "node:path";

export type Role = "user" | "assistant" | "system" | "tool";

export interface Message {
  role: Role;
  content: string;
  at: number;
}

export interface SessionConfig {
  /** 持久化文件；默认 .daimon-session.json */
  file?: string;
  systemPrompt?: string;
}

export class SessionService extends Service {
  private messages: Message[] = [];
  readonly file: string;
  systemPrompt: string;

  constructor(ctx: Context, config: SessionConfig = {}) {
    super(ctx, "session");
    this.file = config.file ?? path.join(process.cwd(), ".daimon-session.json");
    this.systemPrompt = config.systemPrompt ?? "你是一个有帮助的个人助手。";
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.file)) {
        this.messages = JSON.parse(fs.readFileSync(this.file, "utf8"));
      }
    } catch {
      this.messages = [];
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.messages, null, 2), "utf8");
    } catch {
      // 忽略持久化失败
    }
  }

  add(role: Role, content: string): Message {
    const msg: Message = { role, content, at: Date.now() };
    this.messages.push(msg);
    this.save();
    return msg;
  }

  /** 历史（不含 system） */
  history(): Message[] {
    return [...this.messages];
  }

  /** 组装给模型的上下文：system + 历史 */
  context(): Array<{ role: Role; content: string }> {
    return [{ role: "system", content: this.systemPrompt }, ...this.messages];
  }

  clear(): void {
    this.messages = [];
    this.save();
  }
}

export default SessionService;
