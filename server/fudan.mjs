/* 复旦身份认证（新版 id.fudan.edu.cn）与校园数据代理 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ID_BASE = "https://id.fudan.edu.cn";
const COURSE_TABLE = "https://fdjwgl.fudan.edu.cn/student/for-std/course-table";
const EHALL_INFO = "https://ehall.fudan.edu.cn/jsonp/ywtb/info/getUserInfoAndSchoolInfo.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

let DATA_DIR = "";
let state = {
  jar: new Map(),
  loggedIn: false,
  profile: null,
  saved: null,
  lastError: "",
};

async function ensure(dataDir) {
  if (!DATA_DIR) {
    DATA_DIR = dataDir;
    await fs.mkdir(DATA_DIR, { recursive: true });
    state.saved = await loadSaved();
  }
}

const CONFIG_FILE = () => path.join(DATA_DIR, "fudan.json");
const KEY_FILE = () => path.join(DATA_DIR, "fudan-key.bin");

async function getKey() {
  try { return await fs.readFile(KEY_FILE()); }
  catch {
    const key = crypto.randomBytes(32);
    await fs.writeFile(KEY_FILE(), key, { mode: 0o600 });
    return key;
  }
}
async function encrypt(text) {
  if (!text) return "";
  const key = await getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}
async function decrypt(payload) {
  if (!payload) return "";
  try {
    const [iv, tag, data] = String(payload).split(".");
    const key = await getKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch { return ""; }
}
async function loadSaved() {
  try {
    const json = JSON.parse(await fs.readFile(CONFIG_FILE(), "utf8"));
    if (!json || !json.username || !json.password) return null;
    return { username: json.username, password: await decrypt(json.password), savedAt: json.savedAt || 0 };
  } catch { return null; }
}
async function saveSaved(username, password) {
  const payload = { username, password: await encrypt(password), savedAt: Date.now() };
  await fs.writeFile(CONFIG_FILE(), JSON.stringify(payload, null, 2), "utf8");
  state.saved = { username, password, savedAt: payload.savedAt };
}
async function clearSaved() {
  state.saved = null;
  try { await fs.unlink(CONFIG_FILE()); } catch {}
}

/* ---------------- Cookie ---------------- */
function cookieHeader(url) {
  const host = new URL(url).hostname;
  const parts = [];
  for (const [key, item] of state.jar) {
    if (host === item.domain || host.endsWith("." + item.domain)) {
      parts.push(item.name + "=" + item.value);
    }
  }
  return parts.join("; ");
}
function storeCookies(url, list) {
  const host = new URL(url).hostname;
  for (const raw of list || []) {
    const first = raw.split(";")[0];
    const idx = first.indexOf("=");
    if (idx <= 0) continue;
    const name = first.slice(0, idx).trim();
    const value = first.slice(idx + 1).trim();
    const domainMatch = /domain=\.?([^;]+)/i.exec(raw);
    let domain = domainMatch ? domainMatch[1].trim().toLowerCase() : host;
    if (!(host === domain || host.endsWith("." + domain))) domain = host;
    state.jar.set(domain + "|" + name, { domain, name, value });
  }
}
function clearJar() { state.jar.clear(); }

async function request(url, options = {}) {
  let current = url;
  let method = options.method || "GET";
  let body = options.body;
  let contentType = options.contentType;
  let lastResponse = null;
  for (let hop = 0; hop < 12; hop++) {
    const headers = {
      "User-Agent": UA,
      "Accept": "text/html,application/json,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
      ...(options.headers || {}),
    };
    const cookie = cookieHeader(current);
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined && body !== null) {
      headers["Content-Type"] = contentType || "application/json";
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const res = await fetch(current, { method, headers, body, redirect: "manual" });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    storeCookies(current, setCookies);
    lastResponse = res;
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, current).href;
      if (!next.startsWith("https://") || !/(^|\.)fudan\.edu\.cn$/.test(new URL(next).hostname)) {
        throw new Error("认证跳转到了非复旦域名，已停止");
      }
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method !== "GET")) {
        method = "GET"; body = undefined; contentType = undefined;
      }
      current = next;
      continue;
    }
    const text = await res.text();
    return { url: current, status: res.status, text, contentType: res.headers.get("content-type") || "" };
  }
  throw new Error("重定向次数过多");
}

function cleanMessage(msg) {
  const text = String(msg || "").replace(/原因分析[:：]?/g, " ").trim();
  if (/用户名或密码错误/.test(text)) {
    const m = /还有(\d+)次/.exec(text);
    return "学号或密码错误" + (m ? "（还可尝试 " + m[1] + " 次）" : "");
  }
  return text || "认证失败";
}

function parseAuthParams(url) {
  const hash = url.split("#")[1] || "";
  const qs = new URLSearchParams(hash.split("?")[1] || "");
  const lck = qs.get("lck");
  const entityId = qs.get("entityId");
  if (!lck || !entityId) return null;
  return { lck, entityId };
}

async function jsonPost(url, payload) {
  const body = JSON.stringify(payload);
  const res = await request(url, {
    method: "POST", body,
    headers: { "Content-Type": "application/json", Origin: ID_BASE, Referer: ID_BASE + "/ac/" },
  });
  let json = null;
  try { json = JSON.parse(res.text); } catch {}
  return { res, json };
}

function formEncode(obj) {
  return new URLSearchParams(obj).toString();
}

function parseTicket(html, base) {
  const formMatch = /<form[^>]*id=["']logon["'][^>]*>/i.exec(html) || /<form[^>]*action=["'][^"']*["'][^>]*id=["']logon["'][^>]*>/i.exec(html);
  const tag = formMatch ? formMatch[0] : "";
  const action = /action=["']([^"']+)["']/i.exec(tag);
  const ticketTag = /<input[^>]*name=["']ticket["'][^>]*>/i.exec(html) || /<input[^>]*id=["']ticket["'][^>]*>/i.exec(html);
  const ticket = ticketTag ? (/value=["']([^"']*)["']/i.exec(ticketTag[0]) || [])[1] : null;
  if (!action || !ticket) return null;
  const url = new URL(action[1], base);
  url.searchParams.set("ticket", ticket);
  return url.href;
}

async function fetchProfile() {
  try {
    const res = await request(EHALL_INFO);
    const json = JSON.parse(res.text);
    const data = json && json.data ? json.data : {};
    return {
      name: data.userName || data.name || "",
      department: data.userDepartment || "",
      type: data.userTypeName || "",
    };
  } catch {
    return { name: "", department: "", type: "" };
  }
}

async function login(username, password) {
  const user = String(username || "").trim();
  const pass = String(password || "");
  if (!user || !pass) throw new Error("请填写学号和密码");
  clearJar();
  state.loggedIn = false;
  let res = await request(COURSE_TABLE);
  if (!parseAuthParams(res.url)) {
    if (res.url.startsWith(COURSE_TABLE) && res.status === 200) {
      // 已有会话
      state.loggedIn = true;
      state.profile = { id: user, name: user, department: "", type: "" };
      return state.profile;
    }
  }
  const params = parseAuthParams(res.url);
  if (!params) throw new Error("无法解析学校登录入口，请稍后重试");

  const methods = await jsonPost(ID_BASE + "/idp/authn/queryAuthMethods", params);
  if (!methods.json) throw new Error("学校认证服务响应异常");
  if (methods.json.second) throw new Error("学校要求二次验证，请先在浏览器登录 id.fudan.edu.cn 后再试");
  const entries = Array.isArray(methods.json.data) ? methods.json.data : [];
  const chain = entries.find((item) => item && item.moduleCode === "userAndPwd");
  if (!chain || !chain.authChainCode) throw new Error("学校未返回密码认证方式，可能需要在浏览器完成验证");

  const keyRes = await jsonPost(ID_BASE + "/idp/authn/getJsPublicKey", {});
  const key = keyRes.json && keyRes.json.data;
  if (!key || typeof key !== "string") throw new Error("学校认证服务未返回公钥");

  let encrypted = "";
  try {
    const publicKey = crypto.createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" });
    encrypted = crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(pass, "utf8")).toString("base64");
  } catch {
    throw new Error("密码加密失败，学校公钥格式可能已更新");
  }

  const auth = await jsonPost(ID_BASE + "/idp/authn/authExecute", {
    ...params, authModuleCode: "userAndPwd", authChainCode: chain.authChainCode,
    requestType: "chain_type",
    authPara: { loginName: user, password: encrypted, verifyCode: "" },
  });
  const result = auth.json || {};
  if (result.second || /验证码|二次验证|二次认证/.test(String(result.message || ""))) {
    throw new Error("学校要求验证码/二次验证，请先在浏览器登录一次后再试");
  }
  if (!result.loginToken) {
    throw new Error(cleanMessage(result.message) || "学号或密码不正确");
  }

  const engine = await request(ID_BASE + "/idp/authCenter/authnEngine", {
    method: "POST",
    body: formEncode({ loginToken: result.loginToken }),
    contentType: "application/x-www-form-urlencoded",
    headers: { Origin: ID_BASE, Referer: ID_BASE + "/ac/" },
  });
  const ticket = parseTicket(engine.text, engine.url);
  if (!ticket) throw new Error("登录票据解析失败，学校页面可能已更新");
  const done = await request(ticket);
  if (!done.url.startsWith("https://fdjwgl.fudan.edu.cn")) {
    throw new Error("登录后未回到课表页面，可能在浏览器里需要额外验证");
  }
  state.loggedIn = true;
  const profile = await fetchProfile();
  state.profile = { id: user, name: profile.name || user, department: profile.department || "", type: profile.type || "" };
  return state.profile;
}

async function autologin() {
  if (state.loggedIn) return state.profile;
  if (!state.saved) throw new Error("还没有保存登录信息");
  return login(state.saved.username, state.saved.password);
}

async function verifySession() {
  if (!state.loggedIn) return false;
  try {
    const res = await request(COURSE_TABLE);
    if (res.url.startsWith("https://fdjwgl.fudan.edu.cn")) return true;
  } catch {}
  state.loggedIn = false;
  return false;
}

async function proxy(target, options = {}) {
  const url = new URL(String(target || ""));
  if (url.protocol !== "https:" || !/(^|\.)fudan\.edu\.cn$/.test(url.hostname)) {
    throw new Error("只允许访问复旦校内地址");
  }
  if (!state.loggedIn) await autologin().catch(() => {});
  const method = options.method === "POST" ? "POST" : "GET";
  const res = await request(url.href, {
    method,
    body: options.body,
    contentType: options.contentType,
    headers: options.headers,
  });
  return {
    status: res.status,
    url: res.url,
    contentType: res.contentType,
    body: res.text.length > 2 * 1024 * 1024 ? res.text.slice(0, 2 * 1024 * 1024) : res.text,
    loggedIn: state.loggedIn,
  };
}

function status() {
  return {
    loggedIn: !!state.loggedIn,
    profile: state.profile,
    hasSaved: !!state.saved,
    savedUsername: state.saved ? state.saved.username : "",
    savedAt: state.saved ? state.saved.savedAt : 0,
  };
}

async function logout(clear) {
  state.loggedIn = false;
  state.profile = null;
  clearJar();
  if (clear) await clearSaved();
  return { ok: true };
}

export async function handle(req, res, url, ctx) {
  await ensure(ctx.DATA);
  const { readBody, sendJSON } = ctx;
  const p = url.pathname.replace("/api/fudan", "");
  try {
    if (p === "/status") {
      return sendJSON(res, 200, { ok: true, ...status() });
    }
    if (p === "/login" && req.method === "POST") {
      const body = await readBody(req);
      try {
        const profile = await login(body.username, body.password);
        if (body.remember !== false) await saveSaved(body.username, body.password);
        else await clearSaved();
        return sendJSON(res, 200, { ok: true, profile, ...status() });
      } catch (e) {
        return sendJSON(res, 200, { ok: false, error: String(e.message || e) });
      }
    }
    if (p === "/autologin" && req.method === "POST") {
      try {
        const profile = await autologin();
        return sendJSON(res, 200, { ok: true, profile, ...status() });
      } catch (e) {
        return sendJSON(res, 200, { ok: false, error: String(e.message || e) });
      }
    }
    if (p === "/logout" && req.method === "POST") {
      const body = await readBody(req);
      const out = await logout(body.clear !== false);
      return sendJSON(res, 200, { ok: true, ...out, ...status() });
    }
    if (p === "/proxy" && req.method === "POST") {
      const body = await readBody(req);
      try {
        const out = await proxy(body.url, body);
        return sendJSON(res, 200, { ok: true, ...out });
      } catch (e) {
        return sendJSON(res, 200, { ok: false, error: String(e.message || e) });
      }
    }
    return sendJSON(res, 404, { error: "没有这个复旦接口" });
  } catch (err) {
    return sendJSON(res, 500, { ok: false, error: String(err && err.message || err) });
  }
}
