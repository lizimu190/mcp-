import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { spawn, ChildProcess } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";

// ── Python 路径检测 ───────────────────────────────────────

let PYTHON_CMD = "python";
async function detectPython(): Promise<string> {
  for (const cmd of ["python", "python3", "py"]) {
    try {
      const proc = spawn(cmd, ["--version"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      const out = await new Promise<string>((resolve) => {
        let s = "";
        proc.stdout?.on("data", (d: Buffer) => s += d);
        proc.on("close", () => resolve(s));
      });
      if (out.includes("Python")) return cmd;
    } catch {}
  }
  return "python";
}

// ── 临时文件辅助 ──────────────────────────────────────────

const TEMP_DIR = path.join(os.tmpdir(), "mcp-python-sandbox");

async function ensureTempDir() {
  await fs.mkdir(TEMP_DIR, { recursive: true });
}

async function writeTempScript(code: string, ext = ".py"): Promise<string> {
  await ensureTempDir();
  const file = path.join(TEMP_DIR, `script_${randomUUID().slice(0, 8)}${ext}`);
  await fs.writeFile(file, code, "utf-8");
  return file;
}

// ── 一次性 Python 执行 ────────────────────────────────────

interface ExecResult { stdout: string; stderr: string; exitCode: number; timedOut: boolean }

function execPython(code: string, timeout = 30000): Promise<ExecResult> {
  return new Promise(async (resolve) => {
    const file = await writeTempScript(code);
    const child = spawn(PYTHON_CMD, [file], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, MPLBACKEND: "Agg" },
    });

    let stdout = "", stderr = "";
    child.stdout?.on("data", (d: Buffer) => stdout += d);
    child.stderr?.on("data", (d: Buffer) => stderr += d);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000);
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      fs.unlink(file).catch(() => {});
      resolve({ stdout, stderr, exitCode: code ?? 1, timedOut });
    });
  });
}

// ── 持久化 REPL ──────────────────────────────────────────

class PythonREPL {
  private proc: ChildProcess | null = null;
  private buffer = "";
  private errBuffer = "";
  private dataResolve: ((value: { out: string; err: string }) => void) | null = null;
  private sentinel = "";
  private initialized = false;

  async init(): Promise<string> {
    if (this.proc && this.initialized) return "REPL 已就绪";

    await ensureTempDir();
    this.proc = spawn(PYTHON_CMD, ["-u", "-i"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, MPLBACKEND: "Agg", PYTHONUNBUFFERED: "1" },
    });

    this.proc.stdout?.on("data", (d: Buffer) => this.onData(d, false));
    this.proc.stderr?.on("data", (d: Buffer) => this.onData(d, true));

    this.proc.on("exit", () => {
      this.proc = null;
      this.initialized = false;
    });

    // 等待 Python 启动
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (this.buffer.includes(">>>")) {
          clearInterval(check);
          this.buffer = "";
          resolve();
        }
      }, 100);
      setTimeout(() => { clearInterval(check); resolve(); }, 5000);
    });

    // 注入初始化代码
    const initCode = [
      "import sys, json, io, traceback",
      "sys.ps1 = ''",
      "sys.ps2 = ''",
      "print('__REPL_READY__')",
    ].join("\n");

    const result = await this.execute(initCode);
    this.initialized = true;
    return `REPL 已初始化 (Python)`;
  }

  private onData(d: Buffer, isErr: boolean) {
    const text = d.toString();
    if (isErr) {
      if (this.dataResolve) this.errBuffer += text;
      else process.stderr.write(text);
    } else {
      this.buffer += text;
      if (this.dataResolve) {
        const idx = this.buffer.indexOf(this.sentinel);
        if (idx >= 0) {
          const out = this.buffer.slice(0, idx);
          this.buffer = this.buffer.slice(idx + this.sentinel.length);
          const resolve = this.dataResolve;
          this.dataResolve = null;
          resolve({ out, err: this.errBuffer });
          this.errBuffer = "";
        }
      }
    }
  }

  async execute(code: string, timeout = 30000): Promise<{ stdout: string; stderr: string; timedOut: boolean }> {
    if (!this.proc) await this.init();

    this.sentinel = `__DONE_${randomUUID().slice(0, 8)}__`;
    this.buffer = "";
    this.errBuffer = "";

    // 发送代码 + 哨兵打印
    const wrapped = `${code}\nprint('${this.sentinel}')\n`;
    this.proc!.stdin!.write(wrapped);

    return new Promise((resolve) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        this.dataResolve = null;
        resolve({ stdout: this.buffer, stderr: "⏱️ 执行超时，已中断", timedOut: true });
      }, timeout);

      this.dataResolve = ({ out, err }) => {
        clearTimeout(timer);
        resolve({ stdout: out, stderr: err, timedOut: false });
      };
    });
  }

  async getVariables(): Promise<string> {
    const code = `import json\nprint(json.dumps({k: type(v).__name__ for k, v in globals().items() if not k.startswith('_') and k not in ('sys','json','io','traceback')}, ensure_ascii=False))`;
    const { stdout } = await this.execute(code);
    try {
      const vars = JSON.parse(stdout.trim());
      const lines = Object.entries(vars).map(([k, v]) => `  ${k}: ${v}`);
      return lines.length ? `📦 ${lines.length} 个变量:\n${lines.join("\n")}` : "📦 无用户变量";
    } catch { return stdout.trim() || "无法解析变量列表"; }
  }

  kill() {
    this.proc?.kill("SIGTERM");
    this.proc = null;
    this.initialized = false;
  }
}

const repl = new PythonREPL();

// ── 注册工具 ──────────────────────────────────────────────

export function registerCodeInterpreterTools(server: McpServer) {

  // 1. run_python ──────────────────────────────────────────
  server.tool("run_python", "执行 Python 代码并返回输出", {
    code: z.string().describe("Python 代码"),
    timeout: z.number().optional().default(30000).describe("超时毫秒数"),
  }, async ({ code, timeout }) => {
    PYTHON_CMD = await detectPython();
    const { stdout, stderr, exitCode, timedOut } = await execPython(code, timeout);
    const parts: string[] = [];
    if (stdout) parts.push(stdout.trim());
    if (stderr) parts.push(`[STDERR]\n${stderr.trim()}`);
    if (timedOut) parts.push("⏱️ 执行超时已中断");
    parts.push(`[退出码: ${exitCode}]`);
    return { content: [{ type: "text" as const, text: parts.join("\n\n") || "(无输出)" }] };
  });

  // 2. run_python_file ─────────────────────────────────────
  server.tool("run_python_file", "执行 .py 文件", {
    path: z.string().describe(".py 文件路径"),
    args: z.string().optional().describe("命令行参数"),
    timeout: z.number().optional().default(30000).describe("超时毫秒数"),
  }, async ({ path: p, args, timeout }) => {
    PYTHON_CMD = await detectPython();
    return new Promise((resolve) => {
      const child = spawn(PYTHON_CMD, [p, ...(args ? args.split(" ") : [])], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, MPLBACKEND: "Agg" },
      });
      let stdout = "", stderr = "";
      child.stdout?.on("data", (d: Buffer) => stdout += d);
      child.stderr?.on("data", (d: Buffer) => stderr += d);
      const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
      child.on("close", (code) => {
        clearTimeout(timer);
        const parts: string[] = [];
        if (stdout) parts.push(stdout.trim());
        if (stderr) parts.push(`[STDERR]\n${stderr.trim()}`);
        parts.push(`[退出码: ${code ?? 1}]`);
        resolve({ content: [{ type: "text" as const, text: parts.join("\n\n") || "(无输出)" }] });
      });
    });
  });

  // 3. pip_install ─────────────────────────────────────────
  server.tool("pip_install", "安装 Python 包", {
    packages: z.string().describe("包名（多个用空格分隔，如 'numpy pandas matplotlib'）"),
    mirror: z.string().optional().default("https://pypi.tuna.tsinghua.edu.cn/simple").describe("pip 镜像源"),
  }, async ({ packages, mirror }) => {
    PYTHON_CMD = await detectPython();
    const args = ["-m", "pip", "install", ...packages.split(" "), "-i", mirror];
    return new Promise((resolve) => {
      const child = spawn(PYTHON_CMD, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let stdout = "", stderr = "";
      child.stdout?.on("data", (d: Buffer) => stdout += d);
      child.stderr?.on("data", (d: Buffer) => stderr += d);
      const timer = setTimeout(() => child.kill("SIGTERM"), 120000);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          content: [{
            type: "text" as const,
            text: code === 0 ? `✅ 安装成功:\n${stderr.trim() || stdout.trim()}` : `❌ 安装失败 [${code}]:\n${stderr.trim()}`,
          }],
        });
      });
    });
  });

  // 4. python_repl ─────────────────────────────────────────
  server.tool("python_repl", "交互式 Python（变量跨调用保留，类似 Jupyter）", {
    code: z.string().describe("Python 代码"),
    timeout: z.number().optional().default(30000).describe("超时毫秒数"),
  }, async ({ code, timeout }) => {
    PYTHON_CMD = await detectPython();
    try {
      await repl.init();
      const { stdout, stderr, timedOut } = await repl.execute(code, timeout);
      const parts: string[] = [];
      if (stdout) parts.push(stdout.trim());
      if (stderr) parts.push(`[STDERR]\n${stderr.trim()}`);
      if (timedOut) parts.push("⏱️ 执行超时已中断");
      return { content: [{ type: "text" as const, text: parts.join("\n\n") || "(无输出)" }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 5. list_packages ───────────────────────────────────────
  server.tool("list_packages", "列出已安装的 Python 包", {
    filter: z.string().optional().describe("按包名过滤（模糊匹配）"),
  }, async ({ filter }) => {
    PYTHON_CMD = await detectPython();
    const { stdout } = await execPython("import pkg_resources\nprint('\\n'.join(f'{d.project_name} {d.version}' for d in pkg_resources.working_set))", 10000);
    let lines = stdout.trim().split("\n").sort();
    if (filter) lines = lines.filter(l => l.toLowerCase().includes(filter.toLowerCase()));
    return { content: [{ type: "text" as const, text: `📦 ${lines.length} 个包:\n${lines.join("\n")}` }] };
  });

  // 6. save_plot ───────────────────────────────────────────
  server.tool("save_plot", "执行 matplotlib 绑图代码并保存为图片", {
    code: z.string().describe("matplotlib 绑图代码（无需 plt.show()）"),
    filename: z.string().optional().describe("输出文件名（默认 plot_<随机>.png）"),
    dpi: z.number().optional().default(150).describe("图片 DPI"),
  }, async ({ code, filename, dpi }) => {
    PYTHON_CMD = await detectPython();
    await ensureTempDir();
    const outFile = filename
      ? path.resolve(filename)
      : path.join(TEMP_DIR, `plot_${randomUUID().slice(0, 8)}.png`);

    const wrapped = `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
${code}
plt.savefig('${outFile.replace(/\\/g, "\\\\")}', dpi=${dpi}, bbox_inches='tight')
print(f'图片已保存: ${outFile.replace(/\\/g, "\\\\")}')
`;
    const { stdout, stderr, exitCode } = await execPython(wrapped, 30000);
    const parts: string[] = [];
    if (stdout) parts.push(stdout.trim());
    if (stderr) parts.push(`[STDERR]\n${stderr.trim()}`);
    parts.push(`[退出码: ${exitCode}]`);
    return { content: [{ type: "text" as const, text: parts.join("\n\n") }] };
  });

  // 7. run_python_with_timeout ─────────────────────────────
  server.tool("run_python_with_timeout", "带超时中断的 Python 执行器（防死循环）", {
    code: z.string().describe("Python 代码"),
    timeout: z.number().optional().default(30).describe("超时秒数"),
  }, async ({ code, timeout }) => {
    PYTHON_CMD = await detectPython();
    const { stdout, stderr, exitCode, timedOut } = await execPython(code, timeout * 1000);
    const parts: string[] = [];
    if (timedOut) parts.push(`⏱️ 执行超时 (${timeout}s)，进程已强杀`);
    if (stdout) parts.push(stdout.trim());
    if (stderr) parts.push(`[STDERR]\n${stderr.trim()}`);
    if (!timedOut) parts.push(`[退出码: ${exitCode}]`);
    return { content: [{ type: "text" as const, text: parts.join("\n\n") || "(无输出)" }] };
  });

  // 8. get_repl_variables ──────────────────────────────────
  server.tool("get_repl_variables", "列出当前 Python REPL 沙盒中的变量名与类型", {}, async () => {
    PYTHON_CMD = await detectPython();
    try {
      const result = await repl.getVariables();
      return { content: [{ type: "text" as const, text: result }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 9. download_model_weights ──────────────────────────────
  server.tool("download_model_weights", "下载 AI 模型预训练权重（支持断点续传和代理）", {
    url: z.string().describe("权重文件 URL"),
    output: z.string().optional().describe("保存路径（默认保存到 ./weights/ 目录）"),
    proxy: z.string().optional().describe("代理地址（如 http://127.0.0.1:7890）"),
  }, async ({ url, output, proxy }) => {
    PYTHON_CMD = await detectPython();
    const outPath = output || path.join(process.cwd(), "weights", path.basename(new URL(url).pathname));
    await fs.mkdir(path.dirname(outPath), { recursive: true });

    const proxyCode = proxy ? `os.environ['HTTP_PROXY'] = '${proxy}'\nos.environ['HTTPS_PROXY'] = '${proxy}'` : "";

    const code = `
import os, urllib.request, sys
${proxyCode}
url = '${url}'
out = '${outPath.replace(/\\/g, "\\\\")}'

# 断点续传
headers = {}
if os.path.exists(out):
    headers['Range'] = f'bytes={os.path.getsize(out)}-'
    print(f'续传: 已有 {os.path.getsize(out)} 字节')

req = urllib.request.Request(url, headers=headers)
try:
    resp = urllib.request.urlopen(req, timeout=300)
    mode = 'ab' if 'Range' in headers else 'wb'
    if resp.status == 416:  # Range not satisfiable - already complete
        print(f'✅ 文件已完整: {out}')
        sys.exit(0)
    total = int(resp.headers.get('Content-Length', 0))
    downloaded = os.path.getsize(out) if mode == 'ab' else 0
    with open(out, mode) as f:
        while True:
            chunk = resp.read(8192)
            if not chunk: break
            f.write(chunk)
            downloaded += len(chunk)
            if total > 0:
                pct = (downloaded / (total + downloaded - len(chunk) if mode == 'ab' else total)) * 100
                print(f'\\r下载中: {downloaded/1048576:.1f}MB ({pct:.0f}%)', end='', flush=True)
    print(f'\\n✅ 下载完成: {out} ({os.path.getsize(out)/1048576:.1f}MB)')
except Exception as e:
    print(f'❌ 下载失败: {e}', file=sys.stderr)
    sys.exit(1)
`;
    const { stdout, stderr, exitCode } = await execPython(code, 600000);
    return {
      content: [{
        type: "text" as const,
        text: exitCode === 0 ? stdout.trim() : `❌ 下载失败:\n${stderr.trim()}`,
      }],
    };
  });
}
