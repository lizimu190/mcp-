import express from "express";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { createWriteStream } from "fs";
import { registerDataTransformTools } from "./transform";
import { registerWebOverviewTools } from "./web";
import { registerSystemControlTools } from "./system";
import { registerCodeInterpreterTools } from "./code";
import { registerMemoryTools } from "./memory";

// 6 种模式配置
const MODES: Record<string, { port: number; name: string }> = {
  Filesystem:       { port: 3001, name: "文件系统管理" },
  Data_Transform:   { port: 3002, name: "数据文档解析" },
  Web_Overview:     { port: 3003, name: "网页信息概览" },
  System_Control:   { port: 3004, name: "终端与系统控制" },
  Code_Interpreter: { port: 3005, name: "Python 运行沙盒" },
  Memory_System:    { port: 3006, name: "记忆与状态管理" },
};

// 注册文件系统工具
function registerFilesystemTools(server: McpServer) {
  server.tool("read_file", "读取整个文件内容", { path: z.string() }, async ({ path: p }) => {
    try { return { content: [{ type: "text" as const, text: await fs.readFile(p, "utf-8") }] }; }
    catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  server.tool("read_file_chunk", "分块读取文件", {
    path: z.string(), start_line: z.number().optional(), end_line: z.number().optional(),
    offset: z.number().optional(), limit: z.number().optional(),
  }, async ({ path: p, start_line, end_line, offset, limit }) => {
    try {
      const lines = (await fs.readFile(p, "utf-8")).split("\n");
      let s = 0, e = lines.length;
      if (start_line) s = Math.max(0, start_line - 1);
      if (end_line) e = Math.min(lines.length, end_line);
      if (offset) s = offset;
      if (limit) e = Math.min(lines.length, s + limit);
      return { content: [{ type: "text" as const, text: `行 ${s + 1}-${e}（共 ${lines.length} 行）:\n${lines.slice(s, e).join("\n")}` }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  server.tool("tail_file", "读取文件末尾N行", { path: z.string(), lines: z.number().optional().default(50) },
    async ({ path: p, lines: n }) => {
      try {
        const all = (await fs.readFile(p, "utf-8")).split("\n");
        const tail = all.slice(Math.max(0, all.length - n));
        return { content: [{ type: "text" as const, text: `末尾 ${tail.length} 行（共 ${all.length} 行）:\n${tail.join("\n")}` }] };
      } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
    }
  );

  server.tool("write_file", "写入或创建文件", { path: z.string(), content: z.string() },
    async ({ path: p, content }) => {
      try { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, content, "utf-8"); return { content: [{ type: "text" as const, text: `已写入: ${p}` }] }; }
      catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
    }
  );

  server.tool("edit_file", "查找替换", { path: z.string(), old_text: z.string(), new_text: z.string() },
    async ({ path: p, old_text, new_text }) => {
      try {
        let c = await fs.readFile(p, "utf-8");
        if (!c.includes(old_text)) return { content: [{ type: "text" as const, text: "未找到" }], isError: true };
        await fs.writeFile(p, c.replaceAll(old_text, new_text), "utf-8");
        return { content: [{ type: "text" as const, text: "替换完成" }] };
      } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
    }
  );

  server.tool("list_dir", "列出目录", { path: z.string() }, async ({ path: p }) => {
    try {
      const entries = await fs.readdir(p, { withFileTypes: true });
      return { content: [{ type: "text" as const, text: entries.map(e => `${e.isDirectory() ? "[DIR]" : "[FILE]"} ${e.name}`).join("\n") }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  server.tool("delete_file", "删除文件", { path: z.string(), recursive: z.boolean().optional().default(false) },
    async ({ path: p, recursive }) => {
      try { await fs.rm(p, { recursive, force: false }); return { content: [{ type: "text" as const, text: `已删除: ${p}` }] }; }
      catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
    }
  );

  server.tool("move_file", "移动/重命名", { source: z.string(), destination: z.string() },
    async ({ source, destination }) => {
      try { await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.rename(source, destination); return { content: [{ type: "text" as const, text: `已移动: ${source} -> ${destination}` }] }; }
      catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
    }
  );

  server.tool("copy_file", "复制文件", { source: z.string(), destination: z.string() },
    async ({ source, destination }) => {
      try { await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.cp(source, destination, { recursive: true }); return { content: [{ type: "text" as const, text: `已复制: ${source} -> ${destination}` }] }; }
      catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
    }
  );

  server.tool("search_files", "搜索文件", { path: z.string(), pattern: z.string(), content: z.string().optional() },
    async ({ path: dir, pattern, content: kw }) => {
      try {
        const results: string[] = [];
        const re = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
        async function walk(d: string) {
          for (const e of await fs.readdir(d, { withFileTypes: true })) {
            const fp = path.join(d, e.name);
            if (e.isDirectory()) await walk(fp);
            else if (re.test(e.name)) {
              if (kw) { try { if ((await fs.readFile(fp, "utf-8")).includes(kw)) results.push(fp); } catch {} }
              else results.push(fp);
            }
          }
        }
        await walk(dir);
        return { content: [{ type: "text" as const, text: results.length ? results.join("\n") : "未找到" }] };
      } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
    }
  );

  server.tool("file_info", "文件元信息", { path: z.string() }, async ({ path: p }) => {
    try {
      const s = await fs.stat(p);
      return { content: [{ type: "text" as const, text: `路径: ${p}\n类型: ${s.isDirectory() ? "目录" : "文件"}\n大小: ${s.size}\n修改: ${s.mtime.toISOString()}` }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  server.tool("get_cwd", "获取当前工作目录", {}, async () => {
    return { content: [{ type: "text" as const, text: process.cwd() }] };
  });

  server.tool("extract_archive", "解压", { archive_path: z.string(), destination: z.string() },
    async ({ archive_path, destination }) => {
      try {
        await fs.mkdir(destination, { recursive: true });
        if (archive_path.endsWith(".zip")) { (await import("extract-zip")).default(archive_path, { dir: path.resolve(destination) }); }
        else if (archive_path.endsWith(".tar.gz") || archive_path.endsWith(".tgz")) { await (await import("tar")).x({ file: archive_path, C: destination }); }
        else return { content: [{ type: "text" as const, text: "不支持的格式" }], isError: true };
        return { content: [{ type: "text" as const, text: `已解压到: ${destination}` }] };
      } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
    }
  );

  server.tool("compress_files", "打包zip", { source_paths: z.string(), destination: z.string() },
    async ({ source_paths, destination }) => {
      try {
        const { ZipArchive } = await import("archiver");
        await fs.mkdir(path.dirname(destination), { recursive: true });
        const output = createWriteStream(destination);
        const archive = new ZipArchive();
        archive.pipe(output);
        for (const src of source_paths.split(",").map(s => s.trim())) {
          const s = await fs.stat(src);
          if (s.isDirectory()) archive.directory(src, path.basename(src));
          else archive.file(src, { name: path.basename(src) });
        }
        await archive.finalize();
        return { content: [{ type: "text" as const, text: `已打包: ${destination}` }] };
      } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
    }
  );
}

// 根据模式注册对应的工具（各端口完全隔离）
function registerToolsForMode(mode: string, server: McpServer) {
  switch (mode) {
    case "Filesystem":
      registerFilesystemTools(server);
      break;
    case "Data_Transform":
      registerDataTransformTools(server);
      break;
    case "Web_Overview":
      registerWebOverviewTools(server);
      break;
    case "System_Control":
      registerSystemControlTools(server);
      break;
    case "Code_Interpreter":
      registerCodeInterpreterTools(server);
      break;
    case "Memory_System":
      registerMemoryTools(server);
      break;
    default:
      registerFilesystemTools(server);
      break;
  }
}

// 启动单个 MCP 子服务器（SSE + Streamable HTTP 双传输）
function startMcpServer(mode: string, port: number) {
  const app = express();
  app.use(express.json());

  // ===== SSE 传输 =====
  const sseSessions: Map<string, SSEServerTransport> = new Map();

  app.get("/sse", async (_req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    sseSessions.set(transport.sessionId, transport);
    const server = new McpServer({ name: `mcp-${mode}`, version: "1.0.0" });
    registerToolsForMode(mode, server);
    await server.connect(transport);
    transport.onclose = () => { sseSessions.delete(transport.sessionId); };
  });

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = sseSessions.get(sessionId);
    if (!transport) { res.status(404).json({ error: "Session not found" }); return; }
    await transport.handlePostMessage(req, res, req.body);
  });

  // ===== Streamable HTTP 传输 =====
  const httpSessions: Map<string, StreamableHTTPServerTransport> = new Map();

  app.all("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // 已有会话，复用 transport
    if (sessionId && httpSessions.has(sessionId)) {
      const transport = httpSessions.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // 新会话（仅 POST 可创建）
    if (req.method === "POST" && !sessionId) {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
      const server = new McpServer({ name: `mcp-${mode}`, version: "1.0.0" });
      registerToolsForMode(mode, server);
      await server.connect(transport);

      // handleRequest 后 sessionId 才可用
      await transport.handleRequest(req, res, req.body);

      // 存储会话
      const sid = transport.sessionId;
      if (sid) {
        httpSessions.set(sid, transport);
        transport.onclose = () => { httpSessions.delete(sid); };
      }
      return;
    }

    res.status(400).json({ error: "Bad Request" });
  });

  app.listen(port, () => {
    console.log(`[${mode}] MCP Server → http://localhost:${port}/sse | /mcp`);
  });
}

// 统一 Session 管理器
// 前端只需一个 sessionId，路由器内部维护到各端口的 MCP 连接映射
class SessionManager {
  // frontendSessionId → { portMode → mcpSessionId }
  private sessions = new Map<string, Map<string, string>>();

  getPortSession(frontendSid: string, mode: string): string | undefined {
    return this.sessions.get(frontendSid)?.get(mode);
  }

  setPortSession(frontendSid: string, mode: string, mcpSid: string) {
    if (!this.sessions.has(frontendSid)) this.sessions.set(frontendSid, new Map());
    this.sessions.get(frontendSid)!.set(mode, mcpSid);
  }

  has(frontendSid: string, mode: string): boolean {
    return this.sessions.get(frontendSid)?.has(mode) ?? false;
  }

  // 初始化到指定端口的 MCP 连接（握手 + 缓存 session）
  async ensureSession(frontendSid: string, mode: string, port: number): Promise<string> {
    if (this.has(frontendSid, mode)) return this.getPortSession(frontendSid, mode)!;

    const baseUrl = `http://localhost:${port}/mcp`;

    // 1. Initialize
    const initResp = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: `router-${frontendSid}`, version: "1.0" } },
      }),
    });
    const mcpSid = initResp.headers.get("mcp-session-id") || "";

    // 2. Initialized notification
    await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", "mcp-session-id": mcpSid },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });

    this.setPortSession(frontendSid, mode, mcpSid);
    return mcpSid;
  }

  // 转发 MCP 工具调用
  async callTool(frontendSid: string, mode: string, port: number, tool: string, args: Record<string, any>): Promise<any> {
    const mcpSid = await this.ensureSession(frontendSid, mode, port);
    const resp = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", "mcp-session-id": mcpSid },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: tool, arguments: args } }),
    });
    const text = await resp.text();
    const match = text.match(/data: ({.*})/);
    return match ? JSON.parse(match[1]) : JSON.parse(text);
  }

  // 清理会话
  destroy(frontendSid: string) {
    this.sessions.delete(frontendSid);
  }
}

const sessionManager = new SessionManager();

// 总开关路由器
function startRouter() {
  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({
      status: "ok",
      modes: Object.entries(MODES).map(([k, v]) => ({
        mode: k, name: v.name, port: v.port,
        sse: `http://localhost:${v.port}/sse`,
        http: `http://localhost:${v.port}/mcp`,
      })),
    });
  });

  // 前端简易消息接口（统一 sessionId）
  app.post("/message", async (req, res) => {
    const { message, mcp_mode, sessionId } = req.body;
    const mode = MODES[mcp_mode];
    if (!mode) { res.status(400).json({ error: `未知模式: ${mcp_mode}` }); return; }

    try {
      const result = await sessionManager.callTool(sessionId, mcp_mode, mode.port, "read_file", { path: message });
      res.json({ mode: mcp_mode, sessionId, result });
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  // 通用工具调用接口（统一 sessionId）
  app.post("/tool", async (req, res) => {
    const { tool, args, mcp_mode, sessionId } = req.body;
    const mode = MODES[mcp_mode];
    if (!mode) { res.status(400).json({ error: `未知模式: ${mcp_mode}` }); return; }

    try {
      const result = await sessionManager.callTool(sessionId, mcp_mode, mode.port, tool, args || {});
      res.json({ mode: mcp_mode, sessionId, tool, result });
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  // 跨模式工具调用（一次请求调多个端口的工具）
  app.post("/batch", async (req, res) => {
    const { calls, sessionId } = req.body;
    // calls: [{ mcp_mode, tool, args }, ...]
    if (!Array.isArray(calls)) { res.status(400).json({ error: "calls 必须是数组" }); return; }

    try {
      const results = await Promise.all(calls.map(async (call: any) => {
        const mode = MODES[call.mcp_mode];
        if (!mode) return { error: `未知模式: ${call.mcp_mode}` };
        return {
          mode: call.mcp_mode,
          tool: call.tool,
          result: await sessionManager.callTool(sessionId, call.mcp_mode, mode.port, call.tool, call.args || {}),
        };
      }));
      res.json({ sessionId, results });
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  });

  const ROUTER_PORT = 3000;
  app.listen(ROUTER_PORT, () => {
    console.log(`[总开关] 路由器 → http://localhost:${ROUTER_PORT}`);
  });
}

async function main() {
  console.log("========== MCP Server 集群 ==========");
  for (const [mode, config] of Object.entries(MODES)) {
    startMcpServer(mode, config.port);
  }
  startRouter();
  console.log("=====================================");
  console.log("n8n MCP Client 连接地址:");
  for (const [mode, config] of Object.entries(MODES)) {
    console.log(`  ${mode}: http://localhost:${config.port}/sse`);
  }
}

main().catch(console.error);
