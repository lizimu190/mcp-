import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as cheerio from "cheerio";
import { exec } from "child_process";

// ── Cookie 管理 ───────────────────────────────────────────

const cookieJar = new Map<string, string>();

function parseCookies(s: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const pair of s.split(";")) {
    const [k, ...v] = pair.trim().split("=");
    if (k) m.set(k.trim(), v.join("=").trim());
  }
  return m;
}

function cookieHeader(): string {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

// ── 通用请求 ──────────────────────────────────────────────

async function fetchPage(url: string): Promise<{ $: cheerio.CheerioAPI; finalUrl: string; status: number }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml",
      ...(cookieJar.size > 0 ? { Cookie: cookieHeader() } : {}),
    },
    redirect: "follow",
  });
  // 保存 Set-Cookie
  const sc = res.headers.getSetCookie?.() ?? [];
  for (const c of sc) {
    const eq = c.indexOf("=");
    if (eq > 0) cookieJar.set(c.slice(0, eq), c.slice(eq + 1).split(";")[0]);
  }
  const html = await res.text();
  return { $: cheerio.load(html), finalUrl: res.url || url, status: res.status };
}

function resolveUrl(base: string, href: string): string {
  try { return new URL(href, base).href; } catch { return href; }
}

function sameOrigin(a: string, b: string): boolean {
  try { return new URL(a).hostname === new URL(b).hostname; } catch { return false; }
}

// ── 提取辅助函数 ──────────────────────────────────────────

function extractMainText($: cheerio.CheerioAPI, maxChars: number): string {
  // 移除干扰元素
  $("script, style, nav, footer, header, aside, iframe, noscript, svg, form").remove();
  $("[role=navigation], [role=banner], [role=contentinfo]").remove();
  $(".nav, .footer, .header, .sidebar, .menu, .ad, .advertisement").remove();

  // 保留有意义的块级标签，插入换行
  $("h1, h2, h3, h4, h5, h6, p, li, blockquote, tr, br").each(function () {
    $(this).append("\n");
  });

  let text = $("body").text()
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join("\n");

  if (text.length > maxChars) text = text.slice(0, maxChars) + "\n\n[... 内容截断]";
  return text;
}

function extractHeadingTree($: cheerio.CheerioAPI): string[] {
  const result: string[] = [];
  for (let level = 1; level <= 6; level++) {
    $(`h${level}`).each(function () {
      const text = $(this).text().replace(/\s+/g, " ").trim();
      if (text) result.push(`${"  ".repeat(level - 1)}H${level}: ${text}`);
    });
  }
  return result;
}

function extractAllLinks($: cheerio.CheerioAPI, baseUrl: string): { internal: string[]; external: string[] } {
  const internal: string[] = [];
  const external: string[] = [];
  $("a[href]").each(function () {
    const href = $(this).attr("href")?.trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    const full = resolveUrl(baseUrl, href);
    (sameOrigin(full, baseUrl) ? internal : external).push(full);
  });
  return { internal: [...new Set(internal)], external: [...new Set(external)] };
}

// ── 注册工具 ──────────────────────────────────────────────

export function registerWebOverviewTools(server: McpServer) {

  // 1. page_overview ─────────────────────────────────────
  server.tool("page_overview", "获取网页骨架概览（Title/Meta/H1-H3/资源统计）", {
    url: z.string().describe("目标 URL"),
  }, async ({ url }) => {
    try {
      const { $, finalUrl, status } = await fetchPage(url);
      const title = $("title").first().text().trim();
      const desc = $('meta[name="description"]').attr("content")?.trim() || "";
      const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() || "";
      const ogDesc = $('meta[property="og:description"]').attr("content")?.trim() || "";
      const headings = extractHeadingTree($).filter(h => /^H[123]:/.test(h));

      const links = $("a[href]").length;
      const images = $("img").length;
      const scripts = $("script").length;
      const styles = $("link[rel=stylesheet], style").length;

      const lines: string[] = [
        `🌐 ${finalUrl}  [${status}]`,
        `📌 Title: ${title || "(无)"}`,
        desc ? `📝 Description: ${desc}` : "",
        ogTitle ? `🏷️ OG Title: ${ogTitle}` : "",
        ogDesc ? `🏷️ OG Description: ${ogDesc}` : "",
        "",
        "📑 H1-H3 大纲:",
        headings.length ? headings.join("\n") : "  (无标题)",
        "",
        `📊 资源统计: 链接 ${links} | 图片 ${images} | 脚本 ${scripts} | 样式 ${styles}`,
      ];
      return { content: [{ type: "text" as const, text: lines.filter(Boolean).join("\n") }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 2. extract_headings ──────────────────────────────────
  server.tool("extract_headings", "提取页面 H1-H6 标题大纲", {
    url: z.string().describe("目标 URL"),
  }, async ({ url }) => {
    try {
      const { $ } = await fetchPage(url);
      const headings = extractHeadingTree($);
      return { content: [{ type: "text" as const, text: headings.length ? headings.join("\n") : "页面无标题" }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 3. extract_main_content ──────────────────────────────
  server.tool("extract_main_content", "提取网页正文纯文本（阅读模式，过滤广告导航）", {
    url: z.string().describe("目标 URL"),
    max_chars: z.number().optional().default(8000).describe("最大字符数"),
  }, async ({ url, max_chars }) => {
    try {
      const { $ } = await fetchPage(url);
      const text = extractMainText($, max_chars);
      return { content: [{ type: "text" as const, text }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 4. extract_links ─────────────────────────────────────
  server.tool("extract_links", "提取页面所有内外链", {
    url: z.string().describe("目标 URL"),
  }, async ({ url }) => {
    try {
      const { $, finalUrl } = await fetchPage(url);
      const { internal, external } = extractAllLinks($, finalUrl);
      return {
        content: [{
          type: "text" as const,
          text: `内部链接 (${internal.length}):\n${internal.join("\n") || "(无)"}\n\n外部链接 (${external.length}):\n${external.join("\n") || "(无)"}`,
        }],
      };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 5. extract_meta ──────────────────────────────────────
  server.tool("extract_meta", "提取 SEO 与社交分享元数据（Meta/OG/Twitter/JSON-LD）", {
    url: z.string().describe("目标 URL"),
  }, async ({ url }) => {
    try {
      const { $ } = await fetchPage(url);
      const meta: Record<string, any> = {};

      // 基础 Meta
      const title = $("title").first().text().trim();
      if (title) meta.title = title;
      $('meta[name]').each(function () {
        const name = $(this).attr("name")!;
        const content = $(this).attr("content")?.trim();
        if (content) meta[name] = content;
      });

      // OG
      const og: Record<string, string> = {};
      $('meta[property^="og:"]').each(function () {
        const prop = $(this).attr("property")!.replace("og:", "");
        const content = $(this).attr("content")?.trim();
        if (content) og[prop] = content;
      });
      if (Object.keys(og).length > 0) meta.og = og;

      // Twitter Card
      const twitter: Record<string, string> = {};
      $('meta[name^="twitter:"]').each(function () {
        const name = $(this).attr("name")!.replace("twitter:", "");
        const content = $(this).attr("content")?.trim();
        if (content) twitter[name] = content;
      });
      if (Object.keys(twitter).length > 0) meta.twitter = twitter;

      // JSON-LD
      const jsonld: any[] = [];
      $('script[type="application/ld+json"]').each(function () {
        try { jsonld.push(JSON.parse($(this).html() || "")); } catch {}
      });
      if (jsonld.length > 0) meta.jsonld = jsonld;

      return { content: [{ type: "text" as const, text: JSON.stringify(meta, null, 2) }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 6. open_in_system_browser ─────────────────────────────
  server.tool("open_in_system_browser", "在用户电脑的默认浏览器中打开指定 URL", {
    url: z.string().describe("要打开的 URL"),
  }, async ({ url }) => {
    try {
      const cmd = process.platform === "win32" ? `start "" "${url}"`
        : process.platform === "darwin" ? `open "${url}"`
        : `xdg-open "${url}"`;
      exec(cmd);
      return { content: [{ type: "text" as const, text: `已在浏览器中打开: ${url}` }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 7. submit_simple_login ────────────────────────────────
  server.tool("submit_simple_login", "针对无验证码的表单，发送账号密码获取登录状态", {
    url: z.string().describe("登录页面 URL"),
    username: z.string().describe("用户名/邮箱"),
    password: z.string().describe("密码"),
    username_field: z.string().optional().default("username").describe("用户名字段名"),
    password_field: z.string().optional().default("password").describe("密码字段名"),
  }, async ({ url, username, password, username_field, password_field }) => {
    try {
      // 先加载登录页，解析表单
      const { $, finalUrl } = await fetchPage(url);
      const form = $("form").first();
      if (!form.length) return { content: [{ type: "text" as const, text: "页面未找到表单" }], isError: true };

      const action = form.attr("action") || finalUrl;
      const method = (form.attr("method") || "POST").toUpperCase();
      const formUrl = resolveUrl(finalUrl, action);

      // 收集隐藏字段
      const params = new URLSearchParams();
      form.find('input[type=hidden]').each(function () {
        const name = $(this).attr("name");
        const value = $(this).attr("value") || "";
        if (name) params.set(name, value);
      });

      // 设置用户名密码
      params.set(username_field, username);
      params.set(password_field, password);

      // 提交
      const res = await fetch(formUrl, {
        method,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(cookieJar.size > 0 ? { Cookie: cookieHeader() } : {}),
        },
        body: params.toString(),
        redirect: "follow",
      });

      // 保存 cookies
      const sc = res.headers.getSetCookie?.() ?? [];
      for (const c of sc) {
        const eq = c.indexOf("=");
        if (eq > 0) cookieJar.set(c.slice(0, eq), c.slice(eq + 1).split(";")[0]);
      }

      return {
        content: [{
          type: "text" as const,
          text: `登录请求已发送 [${res.status}]\nCookie 已存储 ${cookieJar.size} 条\n${cookieJar.size > 0 ? "✅ 后续请求将自动携带登录状态" : "⚠️ 未收到 Cookie，登录可能失败"}`,
        }],
      };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 8. inject_auth_cookies ───────────────────────────────
  server.tool("inject_auth_cookies", "为后台侦察工具注入身份 Cookie/Token", {
    cookies: z.string().describe("Cookie 字符串（格式：key1=val1; key2=val2）"),
    domain: z.string().optional().describe("适用域名（仅做记录提示）"),
  }, async ({ cookies, domain }) => {
    const parsed = parseCookies(cookies);
    for (const [k, v] of parsed) cookieJar.set(k, v);
    return {
      content: [{
        type: "text" as const,
        text: `已注入 ${parsed.size} 条 Cookie${domain ? ` (${domain})` : ""}\n当前 Cookie 池: ${cookieJar.size} 条\n后续侦察请求将自动携带这些身份凭证`,
      }],
    };
  });
}
