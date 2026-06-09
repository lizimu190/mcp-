import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

// ── 存储结构 ──────────────────────────────────────────────

interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  tags: string[];
  created: string;
  accessed: string;
  accessCount: number;
}

interface NoteEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  created: string;
  updated: string;
}

interface StoreData {
  memories: MemoryEntry[];
  notes: NoteEntry[];
}

const STORE_PATH = path.join(__dirname, "..", "data", "memory_store.json");

let store: StoreData = { memories: [], notes: [] };
let loaded = false;

// ── 持久化读写 ────────────────────────────────────────────

async function loadStore() {
  if (loaded) return;
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    store = JSON.parse(raw);
  } catch {
    store = { memories: [], notes: [] };
  }
  loaded = true;
}

async function saveStore() {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

function now(): string { return new Date().toISOString(); }

// ── 语义匹配 ──────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\w一-鿿]+/g, " ").trim();
}

function matchScore(text: string, queryWords: string[]): number {
  const norm = normalize(text);
  let score = 0;
  for (const w of queryWords) {
    if (norm.includes(w)) score += 1;
  }
  return score;
}

// ── 注册工具 ──────────────────────────────────────────────

export function registerMemoryTools(server: McpServer) {

  // 1. save_memory ─────────────────────────────────────────
  server.tool("save_memory", "存储键值对记忆（支持标签分类）", {
    key: z.string().describe("记忆键名（如 task_1_result）"),
    value: z.string().describe("记忆内容"),
    tags: z.string().optional().describe("标签，逗号分隔（如 '任务A,已验证'）"),
    overwrite: z.boolean().optional().default(true).describe("key 已存在时是否覆盖"),
  }, async ({ key, value, tags, overwrite }) => {
    await loadStore();
    const tagList = tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : [];
    const existing = store.memories.find(m => m.key === key);

    if (existing && !overwrite) {
      return { content: [{ type: "text" as const, text: `⚠️ key "${key}" 已存在，overwrite=false，未覆盖` }] };
    }

    if (existing) {
      existing.value = value;
      existing.tags = [...new Set([...existing.tags, ...tagList])];
      existing.accessed = now();
      await saveStore();
      return { content: [{ type: "text" as const, text: `✅ 已更新记忆: ${key}` }] };
    }

    store.memories.push({
      id: randomUUID().slice(0, 8),
      key, value, tags: tagList,
      created: now(), accessed: now(), accessCount: 0,
    });
    await saveStore();
    return { content: [{ type: "text" as const, text: `✅ 已保存记忆: ${key} (标签: ${tagList.join(", ") || "无"})` }] };
  });

  // 2. recall_memory ───────────────────────────────────────
  server.tool("recall_memory", "按 key 或标签检索记忆（key 和 tags 至少传一个）", {
    key: z.string().optional().describe("精确匹配的 key"),
    tags: z.string().optional().describe("按标签过滤，逗号分隔"),
    limit: z.number().optional().default(10).describe("最大返回条数"),
  }, async ({ key, tags, limit }) => {
    if (!key && !tags) {
      return { content: [{ type: "text" as const, text: "❌ 参数错误: key 和 tags 至少传一个，不允许空调用" }], isError: true };
    }

    await loadStore();
    let results = store.memories;

    if (key) {
      results = results.filter(m => m.key === key);
    }
    if (tags) {
      const filterTags = tags.split(",").map(t => t.trim().toLowerCase());
      results = results.filter(m => filterTags.some(ft => m.tags.map(t => t.toLowerCase()).includes(ft)));
    }

    // 更新访问时间
    for (const m of results.slice(0, limit)) {
      m.accessed = now();
      m.accessCount++;
    }
    await saveStore();

    if (results.length === 0) {
      return { content: [{ type: "text" as const, text: "未找到匹配的记忆" }] };
    }

    const lines = results.slice(0, limit).map(m =>
      `📌 ${m.key} [${m.tags.join(", ")}]\n${m.value}\n  (${m.accessCount}次访问, ${m.created})`
    );
    return { content: [{ type: "text" as const, text: `${lines.join("\n\n")}` }] };
  });

  // 3. list_memories ───────────────────────────────────────
  server.tool("list_memories", "列出所有记忆（可按标签过滤）", {
    tags: z.string().optional().describe("按标签过滤，逗号分隔"),
  }, async ({ tags }) => {
    await loadStore();
    let items = store.memories;

    if (tags) {
      const filterTags = tags.split(",").map(t => t.trim().toLowerCase());
      items = items.filter(m => filterTags.some(ft => m.tags.map(t => t.toLowerCase()).includes(ft)));
    }

    if (items.length === 0) {
      return { content: [{ type: "text" as const, text: "记忆库为空" }] };
    }

    const lines = items.map(m =>
      `• ${m.key} [${m.tags.join(", ")}] — ${m.value.slice(0, 80)}${m.value.length > 80 ? "..." : ""}`
    );
    return { content: [{ type: "text" as const, text: `📦 ${items.length} 条记忆:\n${lines.join("\n")}` }] };
  });

  // 4. forget_memory ───────────────────────────────────────
  server.tool("forget_memory", "删除指定记忆（key 或 id 至少传一个）", {
    key: z.string().optional().describe("要删除的 key"),
    id: z.string().optional().describe("要删除的 id"),
    tags: z.string().optional().describe("删除匹配标签的所有记忆"),
  }, async ({ key, id, tags }) => {
    if (!key && !id) {
      return { content: [{ type: "text" as const, text: "❌ 参数错误: key 和 id 至少传一个，不允许空调用" }], isError: true };
    }

    await loadStore();
    const before = store.memories.length;

    if (key) {
      store.memories = store.memories.filter(m => m.key !== key);
    } else if (id) {
      store.memories = store.memories.filter(m => m.id !== id);
    }

    const deleted = before - store.memories.length;
    await saveStore();
    return { content: [{ type: "text" as const, text: `🗑️ 已删除 ${deleted} 条记忆` }] };
  });

  // 5. save_note ───────────────────────────────────────────
  server.tool("save_note", "保存长文本备忘录", {
    title: z.string().describe("备忘录标题"),
    content: z.string().describe("备忘录内容"),
    tags: z.string().optional().describe("标签，逗号分隔"),
    note_id: z.string().optional().describe("指定 ID 则覆盖已有备忘录"),
  }, async ({ title, content, tags, note_id }) => {
    await loadStore();
    const tagList = tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : [];

    if (note_id) {
      const existing = store.notes.find(n => n.id === note_id);
      if (existing) {
        existing.title = title;
        existing.content = content;
        existing.tags = [...new Set([...existing.tags, ...tagList])];
        existing.updated = now();
        await saveStore();
        return { content: [{ type: "text" as const, text: `✅ 已更新备忘录: ${note_id} — ${title}` }] };
      }
    }

    const id = note_id || randomUUID().slice(0, 8);
    store.notes.push({ id, title, content, tags: tagList, created: now(), updated: now() });
    await saveStore();
    return { content: [{ type: "text" as const, text: `✅ 已保存备忘录: ${id} — ${title}` }] };
  });

  // 6. append_to_note ──────────────────────────────────────
  server.tool("append_to_note", "向已有备忘录末尾追加内容（不覆盖原有内容）", {
    note_id: z.string().describe("目标备忘录 ID"),
    content: z.string().describe("要追加的内容"),
    separator: z.string().optional().default("\n\n").describe("追加分隔符"),
  }, async ({ note_id, content, separator }) => {
    await loadStore();
    const note = store.notes.find(n => n.id === note_id);
    if (!note) {
      return { content: [{ type: "text" as const, text: `未找到备忘录: ${note_id}` }], isError: true };
    }
    note.content += separator + content;
    note.updated = now();
    await saveStore();
    return { content: [{ type: "text" as const, text: `✅ 已追加到备忘录: ${note.title} (${note.content.length} 字符)` }] };
  });

  // 7. get_context ─────────────────────────────────────────
  server.tool("get_context", "获取当前任务上下文摘要（防止对话遗忘）", {
    limit: z.number().optional().default(20).describe("最近记忆条数"),
    include_notes: z.boolean().optional().default(true).describe("是否包含备忘录摘要"),
  }, async ({ limit, include_notes }) => {
    await loadStore();
    const parts: string[] = [];

    // 最近的记忆
    const recent = [...store.memories]
      .sort((a, b) => b.accessed.localeCompare(a.accessed))
      .slice(0, limit);
    if (recent.length > 0) {
      parts.push("📌 最近记忆:");
      for (const m of recent) {
        parts.push(`  • ${m.key}: ${m.value.slice(0, 100)}${m.value.length > 100 ? "..." : ""}`);
      }
    }

    // 备忘录摘要
    if (include_notes && store.notes.length > 0) {
      parts.push("\n📝 备忘录:");
      for (const n of store.notes.slice(-5)) {
        parts.push(`  • [${n.id}] ${n.title} (${n.content.length} 字符, 更新于 ${n.updated})`);
      }
    }

    // 标签统计
    const allTags = store.memories.flatMap(m => m.tags);
    if (allTags.length > 0) {
      const tagCount = new Map<string, number>();
      for (const t of allTags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
      const top = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      parts.push(`\n🏷️ 标签: ${top.map(([t, c]) => `${t}(${c})`).join(" | ")}`);
    }

    return { content: [{ type: "text" as const, text: parts.join("\n") || "记忆库为空" }] };
  });

  // 8. export_memories ─────────────────────────────────────
  server.tool("export_memories", "导出全部记忆为 JSON", {
    output: z.string().optional().describe("导出文件路径（不填则返回 JSON 字符串）"),
  }, async ({ output }) => {
    await loadStore();
    const json = JSON.stringify(store, null, 2);

    if (output) {
      await fs.writeFile(output, json, "utf-8");
      return { content: [{ type: "text" as const, text: `✅ 已导出到: ${output}\n记忆 ${store.memories.length} 条, 备忘录 ${store.notes.length} 条` }] };
    }
    return { content: [{ type: "text" as const, text: json }] };
  });

  // 9. semantic_search ─────────────────────────────────────
  server.tool("semantic_search", "基于自然语言的模糊/语义检索记忆", {
    query: z.string().describe("自然语言查询（如 'MySQL 密码'、'上次分析结果'）"),
    limit: z.number().optional().default(5).describe("最大返回条数"),
  }, async ({ query, limit }) => {
    await loadStore();
    const queryWords = normalize(query).split(" ").filter(w => w.length > 0);
    const maxQueryWords = queryWords.length || 1;

    // 搜索记忆
    const memScores: { item: MemoryEntry; score: number; relevance: number }[] = [];
    for (const m of store.memories) {
      const score = matchScore(`${m.key} ${m.value} ${m.tags.join(" ")}`, queryWords);
      if (score > 0) memScores.push({ item: m, score, relevance: Math.min(1.0, score / maxQueryWords) });
    }

    // 搜索备忘录
    const noteScores: { item: NoteEntry; score: number; relevance: number }[] = [];
    for (const n of store.notes) {
      const score = matchScore(`${n.title} ${n.content} ${n.tags.join(" ")}`, queryWords);
      if (score > 0) noteScores.push({ item: n, score, relevance: Math.min(1.0, score / maxQueryWords) });
    }

    // 合并排序
    memScores.sort((a, b) => b.score - a.score);
    noteScores.sort((a, b) => b.score - a.score);

    const parts: string[] = [];
    if (memScores.length > 0) {
      parts.push(`📌 匹配的记忆 (${memScores.length}):`);
      for (const { item: m, score, relevance } of memScores.slice(0, limit)) {
        m.accessed = now();
        m.accessCount++;
        parts.push(`  [${score}] relevance=${relevance.toFixed(2)} ${m.key}: ${m.value.slice(0, 100)}${m.value.length > 100 ? "..." : ""}`);
      }
    }
    if (noteScores.length > 0) {
      parts.push(`\n📝 匹配的备忘录 (${noteScores.length}):`);
      for (const { item: n, score, relevance } of noteScores.slice(0, limit)) {
        parts.push(`  [${score}] relevance=${relevance.toFixed(2)} [${n.id}] ${n.title} — ${n.content.slice(0, 80)}...`);
      }
    }

    await saveStore();
    return { content: [{ type: "text" as const, text: parts.join("\n") || `未找到与 "${query}" 相关的记忆` }] };
  });

  // 10. compress_context ───────────────────────────────────
  server.tool("compress_context", "自动合并与压缩过期/冗长的记忆，保护上下文窗口", {
    max_memories: z.number().optional().default(30).describe("压缩后保留的最大记忆条数"),
    strategy: z.enum(["summarize", "deduplicate", "truncate"]).default("deduplicate").describe("压缩策略: summarize=合并摘要, deduplicate=去重, truncate=按时间裁剪"),
  }, async ({ max_memories, strategy }) => {
    await loadStore();
    const before = store.memories.length;

    if (strategy === "deduplicate") {
      // 去重：相同 value 的只保留最新
      const seen = new Map<string, MemoryEntry>();
      for (const m of store.memories) {
        const existing = seen.get(m.value);
        if (!existing || m.created > existing.created) seen.set(m.value, m);
      }
      store.memories = [...seen.values()];
    }

    if (strategy === "summarize") {
      // 按标签合并为摘要：同标签多条合并为一条
      const byTag = new Map<string, MemoryEntry[]>();
      for (const m of store.memories) {
        const tag = m.tags[0] || "_untagged";
        if (!byTag.has(tag)) byTag.set(tag, []);
        byTag.get(tag)!.push(m);
      }
      const merged: MemoryEntry[] = [];
      for (const [tag, items] of byTag) {
        if (items.length === 1) {
          merged.push(items[0]);
        } else {
          items.sort((a, b) => b.accessed.localeCompare(a.accessed));
          const summary = items.map(m => `${m.key}: ${m.value.slice(0, 60)}`).join("; ");
          merged.push({
            ...items[0],
            key: `summary_${tag}`,
            value: `[合并 ${items.length} 条] ${summary}`,
            accessed: now(),
          });
        }
      }
      store.memories = merged;
    }

    if (strategy === "truncate") {
      // 按时间顺序删除最旧的条目
      store.memories.sort((a, b) => b.accessed.localeCompare(a.accessed));
    }

    // 最终裁剪：只保留最近的 max_memories 条
    store.memories.sort((a, b) => b.accessed.localeCompare(a.accessed));
    if (store.memories.length > max_memories) {
      store.memories = store.memories.slice(0, max_memories);
    }

    const after = store.memories.length;
    await saveStore();

    return {
      content: [{
        type: "text" as const,
        text: `🗜️ 压缩完成 (${strategy}): ${before} → ${after} 条记忆\n保留: 最近访问的 ${after} 条`,
      }],
    };
  });

  // 11. export_memories（合并原 export_memories + write_memo_to_file）──
  server.tool("export_memories", "导出记忆/备忘录为 JSON 文件（支持全量或单条）", {
    mode: z.enum(["all", "single"]).describe("all=全量导出, single=导出指定 key 的单条记忆"),
    key: z.string().optional().describe("mode=single 时必填，指定要导出的记忆 key"),
    output: z.string().optional().describe("导出文件路径（不填则返回 JSON 字符串）"),
  }, async ({ mode, key, output }) => {
    await loadStore();

    if (mode === "single") {
      if (!key) {
        return { content: [{ type: "text" as const, text: "❌ 参数错误: mode=single 时必须提供 key" }], isError: true };
      }
      const entry = store.memories.find(m => m.key === key);
      if (!entry) {
        return { content: [{ type: "text" as const, text: `❌ 未找到 key="${key}" 的记忆` }], isError: true };
      }
      const json = JSON.stringify({ type: "备忘录", ...entry }, null, 2);
      if (output) {
        await fs.mkdir(path.dirname(output), { recursive: true });
        await fs.writeFile(output, json, "utf-8");
        return { content: [{ type: "text" as const, text: `✅ 单条记忆已导出\n📁 路径: ${output}\n📌 key: ${key}` }] };
      }
      return { content: [{ type: "text" as const, text: json }] };
    }

    // mode === "all"
    const exportData = { type: "备忘录", memories: store.memories, notes: store.notes };
    const json = JSON.stringify(exportData, null, 2);
    if (output) {
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, json, "utf-8");
      return { content: [{ type: "text" as const, text: `✅ 全量导出完成\n📁 路径: ${output}\n记忆 ${store.memories.length} 条, 备忘录 ${store.notes.length} 条` }] };
    }
    return { content: [{ type: "text" as const, text: json }] };
  });
}
