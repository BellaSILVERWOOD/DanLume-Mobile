/* 邮箱桥：IMAP 收件 / SMTP 发件（账号加密存本机） */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

let DATA = null;
const CONFIG_FILE = () => path.join(DATA, "mail-accounts.json");
const KEY_FILE = () => path.join(DATA, "mail-key.bin");

async function ensureData(ctxData) {
  if (!DATA) DATA = ctxData;
  await fs.mkdir(DATA, { recursive: true });
}

async function getKey() {
  try {
    return await fs.readFile(KEY_FILE());
  } catch {
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
    const key = await getKey();
    const [iv, tag, data] = payload.split(".");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch { return ""; }
}

async function loadAccounts() {
  try {
    const text = await fs.readFile(CONFIG_FILE(), "utf8");
    const json = JSON.parse(text);
    return Array.isArray(json) ? json : [];
  } catch { return []; }
}
async function saveAccounts(list) {
  await fs.mkdir(DATA, { recursive: true });
  await fs.writeFile(CONFIG_FILE(), JSON.stringify(list, null, 2), "utf8");
}

function publicAccount(a) {
  return {
    id: a.id, name: a.name, email: a.email,
    imap: { host: a.imap.host, port: a.imap.port, secure: a.imap.secure, user: a.imap.user, hasPass: !!a.imap.pass },
    smtp: { host: a.smtp.host, port: a.smtp.port, secure: a.smtp.secure, user: a.smtp.user, fromName: a.smtp.fromName, hasPass: !!a.smtp.pass },
  };
}

function friendlyError(err) {
  const code = String(err && (err.code || err.responseCode) || "");
  const msg = String(err && (err.responseText || err.message) || err);
  if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|535|EAUTH/i.test(code + " " + msg)) {
    return "登录被服务器拒绝：请确认账号与授权码（QQ/163 要用授权码，不是网页密码）";
  }
  if (/ETIMEDOUT|timeout/i.test(code + " " + msg)) return "连接超时：检查服务器地址、端口和网络（校园网可能需要 VPN）";
  if (/ENOTFOUND|EAI_AGAIN/i.test(code + " " + msg)) return "找不到邮件服务器：检查地址是否写错";
  if (/certificate|self.signed|SSL/i.test(code + " " + msg)) return "TLS 证书校验失败：确认端口与加密方式（993/465 用 SSL）";
  if (/ECONNREFUSED/i.test(code + " " + msg)) return "服务器拒绝连接：端口可能不对，或被防火墙拦截";
  return msg || String(err);
}

async function withImap(account, fn) {
  const client = new ImapFlow({
    host: account.imap.host,
    port: Number(account.imap.port) || 993,
    secure: account.imap.secure !== false,
    auth: { user: account.imap.user, pass: await decrypt(account.imap.pass) },
    logger: false,
    tls: { rejectUnauthorized: false },
    socketTimeout: 30000,
  });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    try { await client.logout(); } catch {}
  }
}

async function transportFor(account) {
  const pass = await decrypt(account.smtp.pass);
  return nodemailer.createTransport({
    host: account.smtp.host,
    port: Number(account.smtp.port) || 465,
    secure: account.smtp.secure !== false,
    auth: { user: account.smtp.user, pass },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 25000,
    greetingTimeout: 20000,
    socketTimeout: 40000,
  });
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .trim();
}

async function sendVia(account, payload) {
  const transport = await transportFor(account);
  const fromName = account.smtp.fromName || account.name || "";
  const from = fromName ? '"' + fromName + '" <' + (account.email || account.smtp.user) + ">" : (account.email || account.smtp.user);
  const mail = {
    from,
    to: payload.to,
    cc: payload.cc || undefined,
    subject: payload.subject || "(无主题)",
    text: payload.text || (payload.html ? htmlToText(payload.html) : ""),
    html: payload.html || undefined,
    attachments: (payload.attachments || []).map((a) => ({
      filename: a.filename || "附件",
      content: Buffer.from(String(a.contentBase64 || ""), "base64"),
    })),
  };
  const info = await transport.sendMail(mail);
  try { transport.close(); } catch {}
  return info;
}

async function parseMessage(source) {
  const parsed = await simpleParser(source);
  let html = parsed.html || "";
  const inline = new Map();
  for (const att of parsed.attachments || []) {
    if (att.cid) {
      const cid = String(att.cid).replace(/[<>]/g, "");
      inline.set(cid, "data:" + (att.contentType || "image/png") + ";base64," + att.content.toString("base64"));
    }
  }
  if (html) {
    html = html.replace(/cid:([^"'\s)]+)/g, (m, cid) => inline.get(decodeURIComponent(cid)) || m);
  }
  const attachments = (parsed.attachments || []).map((att, i) => ({
    index: i,
    filename: att.filename || ("附件" + (i + 1)),
    contentType: att.contentType || "application/octet-stream",
    size: att.size || (att.content ? att.content.length : 0),
    cid: att.cid || null,
    inline: !!att.cid,
  }));
  return {
    subject: parsed.subject || "(无主题)",
    from: parsed.from ? parsed.from.text : "",
    fromName: parsed.from && parsed.from.value && parsed.from.value[0] ? (parsed.from.value[0].name || "") : "",
    fromAddress: parsed.from && parsed.from.value && parsed.from.value[0] ? parsed.from.value[0].address : "",
    to: parsed.to ? parsed.to.text : "",
    cc: parsed.cc ? parsed.cc.text : "",
    date: parsed.date ? parsed.date.toISOString() : "",
    html,
    text: parsed.text || htmlToText(html),
    attachments,
    messageId: parsed.messageId || "",
  };
}

function addrText(list) {
  if (!list) return "";
  return list.map((a) => (a.name ? a.name + " <" + a.address + ">" : a.address)).join(", ");
}

function envelopeSummary(msg) {
  const env = msg.envelope || {};
  return {
    uid: msg.uid,
    subject: env.subject || "(无主题)",
    from: env.from ? env.from.map((a) => a.name || a.address).join(", ") : "",
    fromAddress: env.from && env.from[0] ? env.from[0].address : "",
    to: env.to ? env.to.map((a) => a.address).join(", ") : "",
    date: env.date ? new Date(env.date).toISOString() : (msg.internalDate ? new Date(msg.internalDate).toISOString() : ""),
    seen: msg.flags ? msg.flags.has("\\Seen") : false,
    flagged: msg.flags ? msg.flags.has("\\Flagged") : false,
    size: msg.size || 0,
  };
}

export async function handle(req, res, url, ctx) {
  await ensureData(ctx.DATA);
  const { readBody, sendJSON } = ctx;
  const p = url.pathname.replace("/api/mail", "");
  try {
    if (p === "/accounts" && req.method === "GET") {
      const list = await loadAccounts();
      return sendJSON(res, 200, { accounts: list.map(publicAccount) });
    }
    if (p === "/accounts" && req.method === "POST") {
      const body = await readBody(req);
      const acc = body.account || {};
      if (!acc.email) return sendJSON(res, 400, { error: "缺少邮箱地址" });
      const list = await loadAccounts();
      const existing = acc.id ? list.find((a) => a.id === acc.id) : null;
      const record = existing || { id: "acc" + Date.now().toString(36) };
      record.name = acc.name || acc.email;
      record.email = acc.email;
      record.imap = {
        host: acc.imap && acc.imap.host || "",
        port: Number(acc.imap && acc.imap.port) || 993,
        secure: !(acc.imap && acc.imap.secure === false),
        user: acc.imap && acc.imap.user || acc.email,
        pass: acc.imap && acc.imap.pass ? await encrypt(acc.imap.pass) : (existing ? existing.imap.pass : ""),
      };
      record.smtp = {
        host: acc.smtp && acc.smtp.host || "",
        port: Number(acc.smtp && acc.smtp.port) || 465,
        secure: !(acc.smtp && acc.smtp.secure === false),
        user: acc.smtp && acc.smtp.user || acc.email,
        fromName: acc.smtp && acc.smtp.fromName || "",
        pass: acc.smtp && acc.smtp.pass ? await encrypt(acc.smtp.pass) : (existing ? existing.smtp.pass : ""),
      };
      if (!existing) list.push(record);
      await saveAccounts(list);
      return sendJSON(res, 200, { ok: true, account: publicAccount(record) });
    }
    if (p === "/accounts/delete" && req.method === "POST") {
      const body = await readBody(req);
      const list = (await loadAccounts()).filter((a) => a.id !== body.id);
      await saveAccounts(list);
      return sendJSON(res, 200, { ok: true });
    }
    if (p === "/test" && req.method === "POST") {
      const body = await readBody(req);
      const list = await loadAccounts();
      const acc = list.find((a) => a.id === body.id) || body.account;
      if (!acc) return sendJSON(res, 400, { error: "没有这个账户" });
      if (acc.imap && acc.imap.pass && typeof acc.imap.pass === "string" && !acc.imap.pass.includes(".")) {
        acc.imap = { ...acc.imap, pass: await encrypt(acc.imap.pass) };
      }
      if (acc.smtp && acc.smtp.pass && typeof acc.smtp.pass === "string" && !acc.smtp.pass.includes(".")) {
        acc.smtp = { ...acc.smtp, pass: await encrypt(acc.smtp.pass) };
      }
      const out = {};
      try {
        if (acc.imap && acc.imap.host) {
          await withImap(acc, async (client) => { await client.mailboxOpen("INBOX", { readOnly: true }); });
          out.imap = { ok: true };
        }
      } catch (e) { out.imap = { ok: false, error: friendlyError(e) }; }
      try {
        if (acc.smtp && acc.smtp.host) {
          const t = await transportFor(acc);
          await t.verify();
          try { t.close(); } catch {}
          out.smtp = { ok: true };
        }
      } catch (e) { out.smtp = { ok: false, error: friendlyError(e) }; }
      return sendJSON(res, 200, out);
    }
    if (p === "/folders" && req.method === "GET") {
      const id = url.searchParams.get("accountId");
      const acc = (await loadAccounts()).find((a) => a.id === id);
      if (!acc) return sendJSON(res, 400, { error: "没有这个账户" });
      const folders = await withImap(acc, async (client) => {
        const list = await client.list();
        return list.map((f) => ({ path: f.path, name: f.name, special: f.specialUse || "" }));
      });
      return sendJSON(res, 200, { folders });
    }
    if (p === "/inbox" && req.method === "GET") {
      const id = url.searchParams.get("accountId");
      const acc = (await loadAccounts()).find((a) => a.id === id);
      if (!acc) return sendJSON(res, 400, { error: "没有这个账户" });
      const limit = Math.min(Number(url.searchParams.get("limit")) || 30, 100);
      const folder = url.searchParams.get("folder") || "INBOX";
      const query = (url.searchParams.get("query") || "").trim();
      const data = await withImap(acc, async (client) => {
        const box = await client.mailboxOpen(folder, { readOnly: true });
        let uids;
        if (query) {
          const found = await client.search({ text: query }, { uid: true });
          uids = found || [];
        } else {
          uids = await client.search({ all: true }, { uid: true });
        }
        const tail = uids.slice(-limit).reverse();
        const items = [];
        if (tail.length) {
          for await (const msg of client.fetch(tail.join(","), { uid: true, envelope: true, flags: true, size: true, internalDate: true }, { uid: true })) {
            items.push(envelopeSummary(msg));
          }
        }
        items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        return { total: box.exists, items, folder, mailbox: box.path };
      });
      return sendJSON(res, 200, data);
    }
    if (p === "/message" && req.method === "GET") {
      const id = url.searchParams.get("accountId");
      const uid = url.searchParams.get("uid");
      const folder = url.searchParams.get("folder") || "INBOX";
      const acc = (await loadAccounts()).find((a) => a.id === id);
      if (!acc) return sendJSON(res, 400, { error: "没有这个账户" });
      const data = await withImap(acc, async (client) => {
        await client.mailboxOpen(folder, { readOnly: false });
        const msg = await client.fetchOne(String(uid), { source: true, uid: true, flags: true }, { uid: true });
        if (!msg || !msg.source) return null;
        const parsed = await parseMessage(msg.source);
        try { await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }); } catch {}
        return parsed;
      });
      if (!data) return sendJSON(res, 404, { error: "这封信不在了" });
      return sendJSON(res, 200, data);
    }
    if (p === "/attachment" && req.method === "GET") {
      const id = url.searchParams.get("accountId");
      const uid = url.searchParams.get("uid");
      const folder = url.searchParams.get("folder") || "INBOX";
      const index = Number(url.searchParams.get("index")) || 0;
      const acc = (await loadAccounts()).find((a) => a.id === id);
      if (!acc) return sendJSON(res, 400, { error: "没有这个账户" });
      const attachment = await withImap(acc, async (client) => {
        await client.mailboxOpen(folder, { readOnly: true });
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) return null;
        const parsed = await simpleParser(msg.source);
        const att = (parsed.attachments || [])[index];
        if (!att) return null;
        return { filename: att.filename || "attachment", contentType: att.contentType || "application/octet-stream", content: att.content };
      });
      if (!attachment) return sendJSON(res, 404, { error: "附件不在了" });
      const filename = encodeURIComponent(attachment.filename).replace(/'/g, "%27");
      res.writeHead(200, {
        "Content-Type": attachment.contentType,
        "Content-Disposition": "attachment; filename*=UTF-8''" + filename,
        "Content-Length": attachment.content.length,
        "Cache-Control": "no-store",
      });
      return res.end(attachment.content);
    }
    if (p === "/flags" && req.method === "POST") {
      const body = await readBody(req);
      const acc = (await loadAccounts()).find((a) => a.id === body.accountId);
      if (!acc) return sendJSON(res, 400, { error: "没有这个账户" });
      await withImap(acc, async (client) => {
        await client.mailboxOpen(body.folder || "INBOX", { readOnly: false });
        if (body.seen === true) await client.messageFlagsAdd(String(body.uid), ["\\Seen"], { uid: true });
        else if (body.seen === false) await client.messageFlagsRemove(String(body.uid), ["\\Seen"], { uid: true });
        if (body.flagged === true) await client.messageFlagsAdd(String(body.uid), ["\\Flagged"], { uid: true });
        else if (body.flagged === false) await client.messageFlagsRemove(String(body.uid), ["\\Flagged"], { uid: true });
      });
      return sendJSON(res, 200, { ok: true });
    }
    if (p === "/send" && req.method === "POST") {
      const body = await readBody(req);
      let acc = null;
      if (body.accountId) acc = (await loadAccounts()).find((a) => a.id === body.accountId);
      if (!acc) {
        acc = {
          id: "inline", email: body.from || "", name: body.fromName || "",
          smtp: {
            host: body.smtp && body.smtp.host || "",
            port: Number(body.smtp && body.smtp.port) || 465,
            secure: !(body.smtp && body.smtp.secure === false),
            user: body.smtp && body.smtp.user || body.from || "",
            fromName: body.smtp && body.smtp.fromName || "",
            pass: await encrypt(body.smtp && body.smtp.pass || ""),
          },
          imap: { host: "", port: 993, secure: true, user: "", pass: "" },
        };
      }
      if (!acc.smtp || !acc.smtp.host) return sendJSON(res, 400, { error: "还没有配置发件服务器（SMTP）" });
      const info = await sendVia(acc, body);
      return sendJSON(res, 200, {
        ok: true,
        messageId: info.messageId || "",
        accepted: info.accepted || [],
        rejected: info.rejected || [],
        response: info.response || "",
      });
    }
    return sendJSON(res, 404, { error: "没有这个邮箱接口" });
  } catch (err) {
    console.error("[mail]", err);
    return sendJSON(res, 500, { error: friendlyError(err) });
  }
}
