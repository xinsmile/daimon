/**
 * MemoryService —— 长期记忆能力（daimon capability）。
 * 本地 JSON 持久化 + 轻量关键词召回（不引入向量库，保持零依赖）。
 */

import { Service, type Context } from "cordis";
import * as fs from "node:fs";
import * as path from "node:path";

export interface MemoryItem {
  id: string;
  content: string;
  tags: string[];
  at: number;
}

export interface MemoryConfig {
  /** 持久化文件；默认 .daimon-memory.json */
  file?: string;
}

export class MemoryService extends Service {
  private items: MemoryItem[] = [];
  readonly file: string;

  constructor(ctx: Context, config: MemoryConfig = {}) {
    super(ctx, "memory");
    this.file = config.file ?? path.join(process.cwd(), ".daimon-memory.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.file)) {
        this.items = JSON.parse(fs.readFileSync(this.file, "utf8"));
      }
    } catch {
      this.items = []; // 文件损坏则从头开始，不阻塞启动
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.items, null, 2), "utf8");
    } catch {
      // 持久化失败不应中断对话
    }
  }

  /** 记一条 */
  remember(content: string, tags: string[] = []): MemoryItem {
    const item: MemoryItem = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      content,
      tags,
      at: Date.now(),
    };
    this.items.push(item);
    this.save();
    return item;
  }

  /**
   * 关键词召回：按词命中数打分，返回最相关的若干条。
   * （简单实现；后续可替换为 embedding 检索）
   */
  recall(query: string, limit = 5): MemoryItem[] {
    const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const scored = this.items
      .map((item) => {
        const haystack = `${item.content} ${item.tags.join(" ")}`.toLowerCase();
        let score = 0;
        for (const t of terms) if (haystack.includes(t)) score += 1;
        return { item, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || b.item.at - a.item.at);
    return scored.slice(0, limit).map((s) => s.item);
  }

  all(): MemoryItem[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
    this.save();
  }
}

export default MemoryService;
