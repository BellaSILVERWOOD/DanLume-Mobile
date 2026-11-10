/* DanLume Mobile 本地服务：静态站点 + 邮箱桥 + 网页抓取 + LaTeX 编译 */
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const PORT = Number(process.argv[2] || process.env.PORT || 8787);
const HOST = "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".zip": "application/zip", ".webp": "image/webp",
};

function lanIPs() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === "IPv4" && !item.internal) out.push({ name, address: item.address });
    }
  }
  return out;
}

async function readBody(req, limit = 30 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("请求体太大");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(text); } catch { return {}; }
}

function sendJSON(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/* 各 API 模块延迟加载 */
let mailApi = null;
let webApi = null;
async function getMail() {
  if (!mailApi) mailApi = await import("./server/mail.mjs");
  return mailApi;
}
async function getWeb() {
  if (!webApi) webApi = await import("./server/web.mjs");
  return webApi;
}

async function handleAiProxy(req, res, url) {
  try {
    const data = await readBody(req);
    const base = String(data.base || "").replace(/\/+$/, "");
    const key = String(data.key || "");
    if (!/^https?:\/\//i.test(base)) return sendJSON(res, 400, { error: "服务地址无效" });
    if (!key) return sendJSON(res, 400, { error: "缺少访问密钥" });
    const isModels = url.pathname.endsWith("/models");
    const target = isModels
      ? base.replace(/\/chat\/completions$/, "") + "/models"
      : (/\/chat\/completions$/.test(base) ? base : base + "/chat/completions");
    const payload = { ...data };
    delete payload.base;
    delete payload.key;
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key,
        "User-Agent": "DanLume-Mobile/1.3.2",
      },
      body: JSON.stringify(payload),
    });
    const ctype = upstream.headers.get("content-type") || "application/json";
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      res.writeHead(upstream.status, { "Content-Type": ctype, "Cache-Control": "no-store" });
      return res.end(text);
    }
    if (isModels) {
      const text = await upstream.text();
      res.writeHead(200, { "Content-Type": ctype, "Cache-Control": "no-store" });
      return res.end(text);
    }
    res.writeHead(200, {
      "Content-Type": ctype || "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (e) {
    if (!res.headersSent) sendJSON(res, 502, { error: "AI 服务连接失败：" + (e.message || e) });
    else res.end();
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  try {
    if (url.pathname.startsWith("/api/")) {
      // 允许手机 App（origin=http://127.0.0.1:18787）跨域访问本机服务；
      // 只放行 localhost / 127.0.0.1，不向任意网站开放邮箱接口。
      const origin = req.headers.origin || "";
      if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        res.setHeader("Access-Control-Max-Age", "600");
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }
      if (url.pathname === "/api/health") {
        const mail = await getMail().catch(() => null);
        const web = await getWeb().catch(() => null);
        return sendJSON(res, 200, {
          ok: true, app: "DanLume Mobile", version: "1.0.0", time: new Date().toISOString(),
          features: { mail: !!mail, web: !!web, latex: await hasLatex() },
        });
      }
      if (url.pathname === "/api/ai/chat" || url.pathname === "/api/ai/models") {
        return await handleAiProxy(req, res, url);
      }
      if (url.pathname === "/api/network") {
        return sendJSON(res, 200, { port: PORT, addresses: lanIPs() });
      }
      if (url.pathname.startsWith("/api/fudan/")) {
        const mod = await import("./server/fudan.mjs");
        return await mod.handle(req, res, url, { readBody, sendJSON, DATA });
      }
      if (url.pathname.startsWith("/api/mail/")) {
        const mod = await getMail();
        return await mod.handle(req, res, url, { readBody, sendJSON, DATA });
      }
      if (url.pathname === "/api/web/fetch" || url.pathname === "/api/web/session") {
        const mod = await getWeb();
        return await mod.handle(req, res, url, { readBody, sendJSON, DATA });
      }
      if (url.pathname === "/api/latex/compile") {
        return await compileLatex(req, res);
      }
      return sendJSON(res, 404, { error: "没有这个接口" });
    }

    // 静态文件
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/" || rel === "") rel = "/index.html";
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end("forbidden"); }
    let stat;
    try { stat = await fs.stat(file); } catch { stat = null; }
    if (!stat || !stat.isFile()) {
      const index = path.join(PUBLIC, "index.html");
      const html = await fs.readFile(index);
      res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" });
      return res.end(html);
    }
    const ext = path.extname(file).toLowerCase();
    const data = await fs.readFile(file);
    const isHtml = ext === ".html";
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": isHtml ? "no-cache" : (ext === ".js" || ext === ".css" ? "no-cache" : "public, max-age=86400"),
    });
    res.end(data);
  } catch (err) {
    console.error("[server]", err);
    if (!res.headersSent) sendJSON(res, 500, { error: String(err && err.message || err) });
    else res.end();
  }
});

let latexCache = null;
async function hasLatex() {
  if (latexCache !== null) return latexCache;
  try {
    const { execFile } = await import("node:child_process");
    latexCache = await new Promise((resolve) => {
      execFile("xelatex", ["--version"], { timeout: 4000, windowsHide: true }, (err) => resolve(!err));
    });
    return latexCache;
  } catch { latexCache = false; return false; }
}

async function compileLatex(req, res) {
  if (req.method !== "POST") return sendJSON(res, 405, { error: "只支持 POST" });
  const body = await readBody(req);
  const tex = String(body.tex || "");
  if (!tex.trim()) return sendJSON(res, 400, { error: "没有内容" });
  const id = "job-" + Date.now();
  const dir = path.join(DATA, "latex", id);
  await fs.mkdir(dir, { recursive: true });
  const main = path.join(dir, "main.tex");
  await fs.writeFile(main, tex, "utf8");
  const { execFile } = await import("node:child_process");
  const result = await new Promise((resolve) => {
    execFile("xelatex", ["-interaction=nonstopmode", "-halt-on-error", "main.tex"], {
      cwd: dir, timeout: 90000, windowsHide: true,
    }, (err, stdout, stderr) => resolve({ err, stdout, stderr }));
  });
  if (result.err) {
    const log = (result.stdout || "") + "\n" + (result.stderr || "");
    const tail = log.split("\n").slice(-40).join("\n");
    return sendJSON(res, 200, { ok: false, error: "编译失败（检查是否安装了 XeLaTeX）", log: tail });
  }
  try {
    const pdf = await fs.readFile(path.join(dir, "main.pdf"));
    res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": pdf.length });
    res.end(pdf);
  } catch {
    sendJSON(res, 500, { ok: false, error: "没有生成 PDF" });
  }
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error("\n端口 " + PORT + " 已被占用：可能 DanLume 已经在运行了。\n");
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, async () => {
  const ips = lanIPs();
  const lines = [];
  lines.push("");
  lines.push("  DanLume · 日程与工作汇报 · 手机版");
  lines.push("  ────────────────────────────────────");
  lines.push("  本机访问：  http://127.0.0.1:" + PORT + "/");
  for (const ip of ips) lines.push("  手机访问：  http://" + ip.address + ":" + PORT + "/    (" + ip.name + ")");
  lines.push("");
  lines.push("  手机与电脑连同一个 Wi-Fi，用手机浏览器打开「手机访问」地址。");
  lines.push("  iPhone：Safari → 分享 → 添加到主屏幕；Android：浏览器菜单 → 添加到主屏幕。");
  lines.push("  按 Ctrl+C 停止。");
  lines.push("");
  console.log(lines.join("\n"));
  try {
    const QR = await import("qrcode-terminal");
    const target = ips.length ? "http://" + ips[0].address + ":" + PORT + "/" : "http://127.0.0.1:" + PORT + "/";
    console.log("  扫码在手机上打开：");
    QR.default.generate(target, { small: true }, (code) => console.log(code));
  } catch (e) {}
});
