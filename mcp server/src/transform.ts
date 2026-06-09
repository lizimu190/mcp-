import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";

// ── 工具函数 ──────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [""];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { current[current.length - 1] += '"'; i++; }
        else inQuotes = false;
      } else { current[current.length - 1] += ch; }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") current.push("");
      else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
        if (ch === "\r") i++;
        rows.push(current);
        current = [""];
      } else { current[current.length - 1] += ch; }
    }
  }
  if (current.length > 1 || current[0] !== "") rows.push(current);
  return rows;
}

function csvToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(row => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (row[i] ?? "").trim(); });
    return obj;
  });
}

function escapeMarkdown(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function jsonPathExtract(obj: any, pathStr: string): any {
  const parts = pathStr.replace(/^\$\.?/, "").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    const match = p.match(/^(\w+)(?:\[(\d+)\])?$/);
    if (!match) return undefined;
    cur = cur?.[match[1]];
    if (match[2] !== undefined) cur = cur?.[parseInt(match[2])];
    if (cur === undefined) return undefined;
  }
  return cur;
}

// ── 注册工具 ──────────────────────────────────────────────

export function registerDataTransformTools(server: McpServer) {

  // 1. csv_to_json ────────────────────────────────────────
  server.tool("csv_to_json", "将 CSV 转为 JSON 数组", {
    path: z.string().describe("CSV 文件路径"),
    encoding: z.string().optional().default("utf-8").describe("文件编码"),
  }, async ({ path: p, encoding }) => {
    try {
      const text = await fs.readFile(p, encoding as BufferEncoding);
      const rows = parseCSV(text);
      const data = csvToObjects(rows);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 2. json_to_csv ────────────────────────────────────────
  server.tool("json_to_csv", "将 JSON 数组导出为 CSV 文件", {
    path: z.string().describe("输入 JSON 文件路径"),
    output: z.string().describe("输出 CSV 文件路径"),
  }, async ({ path: p, output }) => {
    try {
      const raw = await fs.readFile(p, "utf-8");
      const data: any[] = JSON.parse(raw);
      if (!Array.isArray(data) || data.length === 0) {
        return { content: [{ type: "text" as const, text: "JSON 不是数组或为空" }], isError: true };
      }
      const headers = [...new Set(data.flatMap(obj => Object.keys(obj)))];
      const csvLines = [headers.join(",")];
      for (const obj of data) {
        csvLines.push(headers.map(h => {
          const v = String(obj[h] ?? "");
          return v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v;
        }).join(","));
      }
      await fs.writeFile(output, csvLines.join("\n"), "utf-8");
      return { content: [{ type: "text" as const, text: `已导出 ${data.length} 行到: ${output}` }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 3. xml_to_json ────────────────────────────────────────
  server.tool("xml_to_json", "解析 XML 为 JSON", {
    path: z.string().describe("XML 文件路径"),
    content: z.string().optional().describe("直接传入 XML 字符串（与 path 二选一）"),
  }, async ({ path: p, content }) => {
    try {
      const { XMLParser } = await import("fast-xml-parser");
      const xml = content ?? await fs.readFile(p, "utf-8");
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
      const result = parser.parse(xml);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 4. csv_to_markdown ────────────────────────────────────
  server.tool("csv_to_markdown", "将 CSV 转为 Markdown 表格", {
    path: z.string().describe("CSV 文件路径"),
    max_rows: z.number().optional().default(50).describe("最大输出行数"),
  }, async ({ path: p, max_rows }) => {
    try {
      const text = await fs.readFile(p, "utf-8");
      const rows = parseCSV(text).slice(0, max_rows + 1);
      if (rows.length === 0) return { content: [{ type: "text" as const, text: "空文件" }] };
      const headers = rows[0].map(h => escapeMarkdown(h));
      const md: string[] = [];
      md.push("| " + headers.join(" | ") + " |");
      md.push("| " + headers.map(() => "---").join(" | ") + " |");
      for (let i = 1; i < rows.length; i++) {
        md.push("| " + rows[i].map(c => escapeMarkdown(c)).join(" | ") + " |");
      }
      return { content: [{ type: "text" as const, text: md.join("\n") }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 5. parse_table_preview ────────────────────────────────
  server.tool("parse_table_preview", "预览 CSV/Excel 的表头与前 N 行", {
    path: z.string().describe("文件路径（.csv 或 .xlsx）"),
    rows: z.number().optional().default(5).describe("预览行数"),
  }, async ({ path: p, rows }) => {
    try {
      const ext = path.extname(p).toLowerCase();
      if (ext === ".csv" || ext === ".tsv") {
        const text = await fs.readFile(p, "utf-8");
        const all = parseCSV(text);
        const preview = all.slice(0, rows + 1);
        const totalRows = all.length - 1;
        let result = `📊 共 ${totalRows} 行，${all[0]?.length ?? 0} 列\n\n`;
        result += preview.map((r, i) => (i === 0 ? "[表头] " : `[${i}] `) + r.join(" | ")).join("\n");
        return { content: [{ type: "text" as const, text: result }] };
      } else if (ext === ".xlsx" || ext === ".xls") {
        const XLSX = await import("xlsx");
        const wb = XLSX.readFile(p);
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        const preview = data.slice(0, rows + 1);
        let result = `📊 Sheet: ${sheetName}，共 ${data.length} 行，${data[0]?.length ?? 0} 列\n\n`;
        result += preview.map((r, i) => (i === 0 ? "[表头] " : `[${i}] `) + r.join(" | ")).join("\n");
        return { content: [{ type: "text" as const, text: result }] };
      }
      return { content: [{ type: "text" as const, text: `不支持的格式: ${ext}` }], isError: true };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 6. json_format ────────────────────────────────────────
  server.tool("json_format", "JSON 美化/压缩/提取字段", {
    path: z.string().optional().describe("JSON 文件路径"),
    content: z.string().optional().describe("直接传入 JSON 字符串"),
    mode: z.enum(["pretty", "minify", "extract"]).default("pretty").describe("模式：pretty/minify/extract"),
    jsonpath: z.string().optional().describe("extract 模式下的 JSONPath（如 $.data[0].name）"),
  }, async ({ path: p, content, mode, jsonpath }) => {
    try {
      const raw = content ?? await fs.readFile(p!, "utf-8");
      const obj = JSON.parse(raw);
      if (mode === "pretty") {
        return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
      } else if (mode === "minify") {
        return { content: [{ type: "text" as const, text: JSON.stringify(obj) }] };
      } else if (mode === "extract") {
        if (!jsonpath) return { content: [{ type: "text" as const, text: "extract 模式需要 jsonpath 参数" }], isError: true };
        const result = jsonPathExtract(obj, jsonpath);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      }
      return { content: [{ type: "text" as const, text: "未知模式" }], isError: true };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 7. list_excel_sheets ──────────────────────────────────
  server.tool("list_excel_sheets", "列出 .xlsx 文件中的所有 Sheet 名称", {
    path: z.string().describe("Excel 文件路径"),
  }, async ({ path: p }) => {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.readFile(p);
      return { content: [{ type: "text" as const, text: `共 ${wb.SheetNames.length} 个 Sheet:\n${wb.SheetNames.map((n, i) => `  ${i + 1}. ${n}`).join("\n")}` }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 8. excel_to_json ──────────────────────────────────────
  server.tool("excel_to_json", "提取 .xlsx 中指定 Sheet 为 JSON 数组", {
    path: z.string().describe("Excel 文件路径"),
    sheet: z.string().optional().describe("Sheet 名称（默认第一个）"),
    max_rows: z.number().optional().default(0).describe("限制行数，0 表示全部"),
  }, async ({ path: p, sheet, max_rows }) => {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.readFile(p);
      const sheetName = sheet ?? wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      if (!ws) return { content: [{ type: "text" as const, text: `Sheet "${sheetName}" 不存在` }], isError: true };
      let data: any[] = XLSX.utils.sheet_to_json(ws);
      if (max_rows > 0) data = data.slice(0, max_rows);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 9. extract_doc_text ───────────────────────────────────
  server.tool("extract_doc_text", "提取 PDF 或 Word (.docx) 文档中的纯文本", {
    path: z.string().describe("文件路径（.pdf 或 .docx）"),
    pages: z.string().optional().describe("PDF 页码范围，如 1-5（默认全部）"),
  }, async ({ path: p, pages }) => {
    try {
      const ext = path.extname(p).toLowerCase();
      const buf = await fs.readFile(p);
      if (ext === ".pdf") {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: new Uint8Array(buf) });
        if (pages) {
          const [s, e] = pages.split("-").map(Number);
          const result = await parser.getText();
          const allPages = result.pages;
          const start = (s || 1) - 1;
          const end = e || allPages.length;
          return { content: [{ type: "text" as const, text: allPages.slice(start, end).map(p => p.text ?? "").join("\n\n") }] };
        }
        const result = await parser.getText();
        return { content: [{ type: "text" as const, text: result.text }] };
      } else if (ext === ".docx") {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer: buf });
        return { content: [{ type: "text" as const, text: result.value }] };
      }
      return { content: [{ type: "text" as const, text: `不支持的格式: ${ext}` }], isError: true };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });

  // 10. html_table_to_json ────────────────────────────────
  server.tool("html_table_to_json", "提取 HTML 中的 <table> 为 JSON", {
    path: z.string().optional().describe("HTML 文件路径"),
    content: z.string().optional().describe("直接传入 HTML 字符串"),
    table_index: z.number().optional().default(0).describe("第几个 table（从 0 开始）"),
  }, async ({ path: p, content, table_index }) => {
    try {
      const cheerio = await import("cheerio");
      const html = content ?? await fs.readFile(p!, "utf-8");
      const $ = cheerio.load(html);
      const tables = $("table");
      if (tables.length === 0) return { content: [{ type: "text" as const, text: "未找到 <table> 元素" }], isError: true };
      const table = tables.eq(table_index);
      const headers: string[] = [];
      table.find("tr").first().find("th,td").each((_, el) => {
        headers.push($(el).text().trim());
      });
      const rows: Record<string, string>[] = [];
      table.find("tr").slice(1).each((_, tr) => {
        const obj: Record<string, string> = {};
        $(tr).find("td").each((i, td) => {
          obj[headers[i] ?? `col${i}`] = $(td).text().trim();
        });
        if (Object.keys(obj).length > 0) rows.push(obj);
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }] };
    } catch (e: any) { return { content: [{ type: "text" as const, text: `错误: ${e.message}` }], isError: true }; }
  });
}
