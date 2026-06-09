import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, execSync, spawn, ChildProcess } from "child_process";
import os from "os";

// ── 异步进程管理 ──────────────────────────────────────────

const asyncProcesses = new Map<number, ChildProcess>();

function registerAsyncProcess(proc: ChildProcess): number {
  const pid = proc.pid!;
  asyncProcesses.set(pid, proc);
  proc.on("exit", () => asyncProcesses.delete(pid));
  return pid;
}

// ── 高危命令拦截 ──────────────────────────────────────────

const DANGEROUS_PATTERNS = [
  /\bmkfs\b/i, /\bdiskpart\b/i, /\bformat\b[^(]/i,
  /\bshutdown\b/i, /\breboot\b/i, /\breg\s+delete\b/i, /\bregedit\b/i,
  /\brm\s+(-rf?|--recursive)\s+[\/\\]/i,
  /\bdel\s+\/[sf]\s+[a-z]:\\?/i,
  /\bnet\s+user\b.*\b(add|delete)\b/i,
  /\bcacls\b/i, /\bicacls\b.*\/(g|grant)\b/i,
];

function isDangerous(cmd: string): string | null {
  for (const re of DANGEROUS_PATTERNS) {
    if (re.test(cmd)) return `高危命令被拦截: 匹配规则 ${re.source}`;
  }
  return null;
}

// ── 跨平台辅助 ────────────────────────────────────────────

const IS_WIN = os.platform() === "win32";

function shellExec(cmd: string, timeout = 30000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    exec(cmd, { encoding: "utf-8", timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ stdout: stdout?.toString() || "", stderr: stderr?.toString() || "", code: err?.code ?? 0 });
    });
  });
}

// ── 注册工具 ──────────────────────────────────────────────

export function registerSystemControlTools(server: McpServer) {

  // 1. run_command ─────────────────────────────────────────
  server.tool("run_command", "同步执行 CMD/Shell 命令，返回 stdout/stderr", {
    command: z.string().describe("要执行的命令"),
    timeout: z.number().optional().default(30000).describe("超时毫秒数"),
  }, async ({ command, timeout }) => {
    const block = isDangerous(command);
    if (block) return { content: [{ type: "text" as const, text: `🚫 ${block}` }], isError: true };
    try {
      const { stdout, stderr, code } = await shellExec(command, timeout);
      const parts: string[] = [];
      if (stdout) parts.push(stdout.trim());
      if (stderr) parts.push(`[STDERR]\n${stderr.trim()}`);
      parts.push(`[退出码: ${code}]`);
      return { content: [{ type: "text" as const, text: parts.join("\n\n") || "(无输出)" }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 2. run_command_async ───────────────────────────────────
  server.tool("run_command_async", "后台异步执行长时间命令，返回 PID", {
    command: z.string().describe("要执行的命令"),
  }, async ({ command }) => {
    const block = isDangerous(command);
    if (block) return { content: [{ type: "text" as const, text: `🚫 ${block}` }], isError: true };
    try {
      const child = spawn(command, [], { shell: true, detached: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      const pid = registerAsyncProcess(child);
      let output = "";
      child.stdout?.on("data", (d: Buffer) => { output += d.toString(); });
      child.stderr?.on("data", (d: Buffer) => { output += d.toString(); });

      return {
        content: [{
          type: "text" as const,
          text: `💻 后台任务已启动\nPID: ${pid}\n命令: ${command}\n\n使用 send_process_input(PID) 发送输入\n使用 kill_process(PID) 终止`,
        }],
      };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 3. send_process_input ──────────────────────────────────
  server.tool("send_process_input", "向异步进程发送 stdin 输入", {
    pid: z.number().describe("目标进程 PID"),
    input: z.string().describe("要发送的文本（自动追加换行）"),
  }, async ({ pid, input }) => {
    const proc = asyncProcesses.get(pid);
    if (!proc) return { content: [{ type: "text" as const, text: `PID ${pid} 不在管理列表中（可能已退出或非 async 启动）` }], isError: true };
    try {
      proc.stdin?.write(input.endsWith("\n") ? input : input + "\n");
      return { content: [{ type: "text" as const, text: `✅ 已发送到 PID ${pid}: ${input}` }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 4. list_processes ──────────────────────────────────────
  server.tool("list_processes", "列出系统进程（可按名称过滤）", {
    filter: z.string().optional().describe("按进程名过滤（模糊匹配）"),
    top: z.number().optional().default(30).describe("最多返回条数"),
  }, async ({ filter, top }) => {
    try {
      let cmd: string;
      if (IS_WIN) {
        cmd = filter
          ? `tasklist /FI "IMAGENAME eq *${filter}*" /FO CSV /NH`
          : `tasklist /FO CSV /NH`;
      } else {
        cmd = filter ? `ps aux | grep -i "${filter}"` : `ps aux`;
      }
      const { stdout } = await shellExec(cmd, 10000);
      const lines = stdout.trim().split("\n").slice(0, top);
      return { content: [{ type: "text" as const, text: lines.join("\n") || "无匹配进程" }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 5. check_port ──────────────────────────────────────────
  server.tool("check_port", "检查端口占用情况，返回占用进程的 PID 和名称", {
    port: z.number().describe("端口号"),
  }, async ({ port }) => {
    try {
      let cmd: string;
      if (IS_WIN) {
        cmd = `netstat -ano | findstr ":${port} " | findstr "LISTENING"`;
      } else {
        cmd = `lsof -i :${port} -P -n 2>/dev/null || ss -tlnp sport = :${port}`;
      }
      const { stdout } = await shellExec(cmd, 10000);
      if (!stdout.trim()) {
        return { content: [{ type: "text" as const, text: `端口 ${port} 未被占用` }] };
      }

      // Windows: 解析 netstat 输出获取 PID
      if (IS_WIN) {
        const pids = new Set<string>();
        for (const line of stdout.trim().split("\n")) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && pid !== "0") pids.add(pid);
        }
        const details: string[] = [];
        for (const pid of pids) {
          const { stdout: procOut } = await shellExec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, 5000);
          details.push(`PID ${pid}: ${procOut.trim()}`);
        }
        return { content: [{ type: "text" as const, text: `端口 ${port} 被占用:\n${details.join("\n")}` }] };
      }
      return { content: [{ type: "text" as const, text: `端口 ${port} 被占用:\n${stdout.trim()}` }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 6. kill_process ───────────────────────────────────────
  server.tool("kill_process", "强制结束指定进程", {
    pid: z.number().optional().describe("进程 PID"),
    name: z.string().optional().describe("进程名称（Windows 下如 notepad.exe）"),
  }, async ({ pid, name }) => {
    if (!pid && !name) return { content: [{ type: "text" as const, text: "必须提供 pid 或 name" }], isError: true };
    try {
      let cmd: string;
      if (pid) {
        // 同时清理内部管理
        const managed = asyncProcesses.get(pid);
        if (managed) { managed.kill("SIGTERM"); asyncProcesses.delete(pid); }
        cmd = IS_WIN ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`;
      } else {
        cmd = IS_WIN ? `taskkill /F /IM "${name}"` : `pkill -9 -f "${name}"`;
      }
      const { stdout, stderr } = await shellExec(cmd, 10000);
      return { content: [{ type: "text" as const, text: stdout.trim() || stderr.trim() || "已发送终止信号" }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 7. system_info ─────────────────────────────────────────
  server.tool("system_info", "获取系统 CPU/内存/磁盘/网络状态", {}, async () => {
    try {
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const loadavg = os.loadavg();

      const lines: string[] = [
        `🖥️ 系统: ${os.type()} ${os.release()} (${os.arch()})`,
        `⏱️ 运行时间: ${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
        ``,
        `🔧 CPU: ${cpus[0]?.model || "未知"} × ${cpus.length} 核`,
        `   负载: ${loadavg.map(l => l.toFixed(2)).join(" / ")} (1/5/15min)`,
        ``,
        `💾 内存: ${(usedMem / 1073741824).toFixed(1)}GB / ${(totalMem / 1073741824).toFixed(1)}GB (${(usedMem / totalMem * 100).toFixed(1)}%)`,
        `   可用: ${(freeMem / 1073741824).toFixed(1)}GB`,
      ];

      // 磁盘（Windows）
      if (IS_WIN) {
        const { stdout } = await shellExec("wmic logicaldisk get size,freespace,caption /format:csv", 10000);
        const diskLines = stdout.trim().split("\n").filter(l => l.includes(",") && !l.includes("Node"));
        if (diskLines.length > 0) {
          lines.push("", "📀 磁盘:");
          for (const dl of diskLines) {
            const parts = dl.trim().split(",");
            if (parts.length >= 4) {
              const drive = parts[1];
              const free = parseInt(parts[2]) / 1073741824;
              const total = parseInt(parts[3]) / 1073741824;
              if (total > 0) lines.push(`   ${drive} ${free.toFixed(1)}GB 可用 / ${total.toFixed(1)}GB 总计`);
            }
          }
        }
      }

      // 网络接口
      const nets = os.networkInterfaces();
      lines.push("", "🌐 网络:");
      for (const [name, addrs] of Object.entries(nets)) {
        const ipv4 = addrs?.find(a => a.family === "IPv4" && !a.internal);
        if (ipv4) lines.push(`   ${name}: ${ipv4.address}`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 8. get_env ─────────────────────────────────────────────
  server.tool("get_env", "查找系统环境变量", {
    name: z.string().describe("环境变量名（如 PATH, NODE_ENV）"),
  }, async ({ name }) => {
    const value = process.env[name];
    if (value === undefined) {
      return { content: [{ type: "text" as const, text: `环境变量 ${name} 未设置` }] };
    }
    return { content: [{ type: "text" as const, text: `${name}=${value}` }] };
  });

  // 9. open_app ────────────────────────────────────────────
  server.tool("open_app", "打开本地桌面应用", {
    app: z.string().describe("应用名称或路径（如 notepad, code, chrome）"),
    args: z.string().optional().describe("启动参数"),
  }, async ({ app, args }) => {
    try {
      let cmd: string;
      if (IS_WIN) {
        cmd = args ? `start "" "${app}" ${args}` : `start "" "${app}"`;
      } else {
        cmd = args ? `${app} ${args} &` : `${app} &`;
      }
      exec(cmd, { windowsHide: false });
      return { content: [{ type: "text" as const, text: `已打开: ${app}${args ? " " + args : ""}` }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 10. clipboard_read ─────────────────────────────────────
  server.tool("clipboard_read", "读取剪贴板文本内容", {}, async () => {
    try {
      let text: string;
      if (IS_WIN) {
        const { stdout } = await shellExec("powershell -command \"Get-Clipboard -Format Text\"", 5000);
        text = stdout.trim();
      } else {
        const { stdout } = await shellExec("pbpaste", 5000);
        text = stdout.trim();
      }
      return { content: [{ type: "text" as const, text: text || "(剪贴板为空或非文本内容)" }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 11. clipboard_write ────────────────────────────────────
  server.tool("clipboard_write", "将文本写入剪贴板", {
    text: z.string().describe("要写入剪贴板的文本"),
  }, async ({ text }) => {
    try {
      if (IS_WIN) {
        // 通过 stdin 传递，避免转义问题
        const child = spawn("clip", [], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
        child.stdin.write(text);
        child.stdin.end();
        await new Promise<void>((resolve) => child.on("close", () => resolve()));
      } else {
        const child = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
        child.stdin.write(text);
        child.stdin.end();
        await new Promise<void>((resolve) => child.on("close", () => resolve()));
      }
      const preview = text.length > 100 ? text.slice(0, 100) + "..." : text;
      return { content: [{ type: "text" as const, text: `📋 已复制到剪贴板 (${text.length} 字符)\n预览: ${preview}` }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 12. show_notification ──────────────────────────────────
  server.tool("show_notification", "发送系统 Toast 弹窗通知", {
    title: z.string().describe("通知标题"),
    message: z.string().describe("通知内容"),
  }, async ({ title, message }) => {
    try {
      if (IS_WIN) {
        const ps = `
          [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
          [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
          $template = '<toast><visual><binding template="ToastText02"><text id="1">${title.replace(/'/g, "''")}</text><text id="2">${message.replace(/'/g, "''")}</text></binding></visual></toast>'
          $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
          $xml.LoadXml($template)
          $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
          [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("MCP Agent").Show($toast)
        `;
        exec(`powershell -command "${ps.replace(/"/g, '\\"').replace(/\n/g, "; ")}"`, { windowsHide: true });
      } else {
        exec(`notify-send "${title}" "${message}"`);
      }
      return { content: [{ type: "text" as const, text: `🔔 通知已发送: ${title}` }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });
}
