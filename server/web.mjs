/* 网页桥：带 Cookie 抓取页面 / 提取通知 */
import fs from "node:fs/promises";
import path from "node:path";

let DATA_DIR = null;
let jar = new Map();

async function ensure(ctxData) {
  if (!DATA_DIR) {
    DATA_DIR = ctxData;
    try {
      const raw = await fs.readFile(path.join(DATA_DIR, "cookies.json"), "utf8");
      const obj = JSON.parse(raw);
      jar = new Map(Object.entries(obj));
    } catch {}
  }
}
async function persist() {
  try { await fs.writeFile(path.join(DATA_DIR, "cookies.json"), JSON.stringify(Object.fromEntries(jar), null, 2)); } catch {}
}

function cookiesFor(url) {
  const host = new URL(url).hostname;
  const parts = [];
  for (const [key, item] of jar) {
    if (item.host === host || host.endsWith(item.host)) {
      parts.push(item.name + "=" + item.value);
    }
  }
  return parts.join("; ");
}

function storeCookies(url, setCookie) {
  if (!setCookie) return;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  const host = new URL(url).hostname;
  for (const raw of list) {
    const first = String(raw).split(";")[0];
    const idx = first.indexOf("=");
    if (idx <= 0) continue;
    const name = first.slice(0, idx).trim();
    const value = first.slice(idx + 1).trim();
    jar.set(host + "|" + name, { host, name, value });
  }
  persist();
}

export async function fetchPage(url, extraHeaders = {}) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6",
    ...extraHeaders,
  };
  const cookie = cookiesFor(url);
  if (cookie) headers.Cookie = cookie;
  const resp = await fetch(url, { headers, redirect: "follow" });
  const setCookie = resp.headers.getSetCookie ? resp.headers.getSetCookie() : resp.headers.get("set-cookie");
  storeCookies(url, setCookie);
  const text = await resp.text();
  return { status: resp.status, url: resp.url, text, headers: resp.headers };
}

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
}
function stripTags(html) {
  return decodeEntities(String(html).replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function extractLinks(html, baseUrl) {
  const out = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    let href = decodeEntities(m[1].trim());
    if (!href || href.startsWith("javascript:") || href.startsWith("#")) continue;
    if (href.startsWith("//")) href = new URL(baseUrl).protocol + href;
    let absolute;
    try { absolute = new URL(href, baseUrl).href; } catch { continue; }
    if (!/^https?:/i.test(absolute)) continue;
    const title = stripTags(m[2]);
    if (!title || title.length < 4 || title.length > 120) continue;
    out.push({ title, url: absolute });
  }
  return out;
}

function findDates(html) {
  const m = String(html).match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!m) return "";
  return m[1] + "-" + String(m[2]).padStart(2, "0") + "-" + String(m[3]).padStart(2, "0");
}

export async function handle(req, res, url, ctx) {
  await ensure(ctx.DATA);
  const { readBody, sendJSON } = ctx;
  try {
    if (url.pathname === "/api/web/notices") {
      const body = await readBody(req);
      const target = String(body.url || "");
      if (!/^https?:/.test(target)) return sendJSON(res, 400, { error: "地址不对" });
      const page = await fetchPage(target);
      const links = extractLinks(page.text, page.url);
      const keywords = /通知|公告|新闻|通告|notice|detail|content|news/i;
      const seen = new Set();
      const items = [];
      for (const link of links) {
        if (seen.has(link.url)) continue;
        seen.add(link.url);
        const score = (keywords.test(link.url) ? 2 : 0) + (keywords.test(link.title) ? 2 : 0);
        if (score < 2) continue;
        items.push({ ...link, score, date: "" });
      }
      items.sort((a, b) => b.score - a.score);
      const limited = items.slice(0, Math.min(Number(body.limit) || 20, 50));
      return sendJSON(res, 200, { ok: true, url: page.url, total: items.length, items: limited });
    }
    if (url.pathname === "/api/web/fetch") {
      const body = await readBody(req);
      const target = String(body.url || url.searchParams.get("url") || "");
      if (!/^https?:/.test(target)) return sendJSON(res, 400, { error: "地址不对" });
      const page = await fetchPage(target);
      return sendJSON(res, 200, {
        ok: true, status: page.status, url: page.url,
        title: (page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ""])[1].trim(),
        text: stripTags(page.text).slice(0, Number(body.limit) || 4000),
        html: body.raw ? page.text.slice(0, 200000) : undefined,
      });
    }
    if (url.pathname === "/api/web/session") {
      const host = url.searchParams.get("host") || "";
      const count = Array.from(jar.values()).filter((c) => !host || c.host === host).length;
      return sendJSON(res, 200, { cookies: count, hosts: Array.from(new Set(Array.from(jar.values()).map((c) => c.host))) });
    }
    return sendJSON(res, 404, { error: "没有这个网页接口" });
  } catch (err) {
    return sendJSON(res, 500, { error: String(err && err.message || err) });
  }
}
