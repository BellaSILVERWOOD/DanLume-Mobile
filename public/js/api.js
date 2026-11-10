/* 本地服务桥（邮箱 / 网页抓取 / LaTeX）+ 通用请求 */
import { getSetting } from "./db.js";

export function bridge() {
  let base = (getSetting("bridgeUrl", "") || "").trim().replace(/\/+$/, "");
  if (base) return base;
  if (location.protocol.startsWith("http")) return location.origin;
  return "";
}

export async function bridgeFetch(path, body, { method = "POST", timeout = 20000, base: overrideBase = "" } = {}) {
  const base = overrideBase || bridge();
  if (!base) throw new Error("没有本地服务地址");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}
    if (!resp.ok) throw new Error((json && (json.error || json.message)) || ("请求失败 " + resp.status));
    return json === null ? text : json;
  } finally { clearTimeout(t); }
}

export async function checkBridge() {
  try {
    const r = await bridgeFetch("/api/health", undefined, { method: "GET", timeout: 4000 });
    return r && r.ok ? r : null;
  } catch (e) { return null; }
}

export function bridgeBase() { return bridge(); }
