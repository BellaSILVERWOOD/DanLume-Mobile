/* 邮箱：收件箱 / 发件箱 / 写信（需要本地服务） */
import { db, getSetting, setSetting } from "../db.js";
import { setHeader, navigate, getRoute } from "../shell.js";
import { icon } from "../icons.js";
import { esc, toast, emptyState, openSheet, confirmDialog, actionSheet, qs, el } from "../ui.js";
import { fmtRelative, fmtDateCN, formatBytes, uid, readFile, downloadBlob } from "../util.js";
import { bridge, bridgeFetch, checkBridge } from "../api.js";

let rootEl = null;
let accounts = [];
let bridgeOk = false;
let bridgeInfo = null;
let tab = "inbox";
let accountId = "";
let inbox = [];
let loadingInbox = false;
let inboxError = "";
let query = "";

const STATUS = {
  draft: { label: "草稿", cls: "" },
  sent: { label: "已发送", cls: "ok" },
  failed: { label: "发送失败", cls: "danger" },
};

export async function render(root) {
  rootEl = root;
  setHeader("邮箱", "", [
    { icon: "refresh", title: "刷新", onClick: () => reload(true) },
    { icon: "pen", title: "写信", onClick: () => openCompose({}) },
  ]);
  await reload(false);
  return () => {
    if (rootEl === root) rootEl = null;
  };
}

async function reload(keepAccount) {
  paint(loadingInbox);
  let health = isApk() ? { ok: true, features: { mail: true } } : await checkBridge();
  if (!health) {
    // 有些 WebView 不会带自定义 UA；只要同源 /api/mail 能响应，就按内置邮箱处理
    try {
      await bridgeFetch("/api/mail/accounts", undefined, { method: "GET", base: location.origin, timeout: 6000 });
      health = { ok: true, features: { mail: true } };
    } catch (e) {}
  }
  bridgeOk = !!health;
  bridgeInfo = health;
  if (bridgeOk) {
    try {
      const data = ensureOk(await bridgeFetch("/api/mail/accounts", undefined, { method: "GET", base: mailBase() }));
      accounts = data.accounts || [];
      if (!accounts.some((a) => a.id === accountId)) accountId = accounts.length ? accounts[0].id : "";
    } catch (e) { accounts = []; }
  }
  const local = await db.all("mails");
  inbox = local.filter((m) => m.folder === "inbox" && (!accountId || m.accountId === accountId));
  inbox.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  await refreshOutbox();
  paint();
  if (bridgeOk && accountId && tab === "inbox" && getRoute() === "mail") fetchInbox();
}

function paint(busy) {
  if (!rootEl || getRoute() !== "mail") return;
  rootEl.innerHTML =
    (bridgeOk ? "" : bridgeBanner()) +
    (accounts.length ? '<div class="chips" style="margin:2px 0 10px;overflow-x:auto;flex-wrap:nowrap">' +
      accounts.map((a) => '<button class="chip ' + (a.id === accountId ? "active" : "") + '" data-acc="' + a.id + '">' +
        icon("mail") + esc(a.name || a.email) + "</button>").join("") +
      '<button class="chip" data-acc-manage="1">' + icon("settings") + "管理</button>" +
      "</div>" : "") +
    '<div class="segmented" style="margin-bottom:12px">' +
      '<button data-tab="inbox" class="' + (tab === "inbox" ? "active" : "") + '">收件箱</button>' +
      '<button data-tab="outbox" class="' + (tab === "outbox" ? "active" : "") + '">发件箱</button>' +
      '<button data-tab="report" class="' + (tab === "report" ? "active" : "") + '">汇报</button>' +
    "</div>" +
    (tab === "inbox" ? inboxHtml(busy) : tab === "outbox" ? outboxHtml() : reportHtml()) +
    '<div style="height:16px"></div>';

  rootEl.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { tab = b.dataset.tab; paint(); });
  rootEl.querySelectorAll("[data-acc]").forEach((b) => b.onclick = () => { accountId = b.dataset.acc; tab = "inbox"; reload(true); });
  const manage = rootEl.querySelector("[data-acc-manage]");
  if (manage) manage.onclick = () => openAccounts();
  const addAcc = rootEl.querySelector("#add-account");
  if (addAcc) addAcc.onclick = () => openAccountEditor(null);
  const retry = rootEl.querySelector("#bridge-retry");
  if (retry) retry.onclick = () => reload(true);
  if (tab === "inbox") bindInbox();
  if (tab === "outbox") bindOutbox();
  if (tab === "report") bindReport();
}

function isApk() { return /DanLumeApp/.test(navigator.userAgent); }

// APK 里邮箱由应用内 JavaMail 服务处理，不受「本地服务地址」影响
function mailBase() {
  if (isApk()) return location.origin;
  return bridge() || location.origin;
}

function ensureOk(data) {
  if (data && data.ok === false) throw new Error(data.error || "邮箱服务返回失败");
  return data;
}

function bridgeBanner() {
  return '<div class="card tint" style="margin-bottom:12px">' +
    '<div class="row"><span class="card-ico">' + icon("server") + '</span><span class="card-title">邮箱需要本地服务</span></div>' +
    '<div class="small muted" style="margin-top:8px;line-height:1.6">浏览器不能直接连 IMAP/SMTP。在这台电脑上运行 <b>启动 DanLume 手机版.bat</b>，手机连同一个 Wi-Fi，然后在「设置 → 本地服务」里填电脑的地址。</div>' +
    '<div class="code-block" style="margin-top:10px">http://电脑IP:8787</div>' +
    '<div class="btn-row" style="margin-top:10px"><button class="btn small primary" id="bridge-retry">重新检测</button>' +
    '<button class="btn small ghost" data-go="settings">本地服务设置</button></div></div>';
}

function inboxHtml(busy) {
  if (!accounts.length) {
    return '<div class="card">' + emptyState("mail", "还没有邮箱账户", "添加 IMAP / SMTP 账户后就能在这里收信。",
      '<button class="btn small primary" id="add-account">添加邮箱</button>') + "</div>" +
      '<div class="hint" style="margin-top:12px">QQ / 163 / 126 邮箱请先在网页版开启 SMTP，并使用「授权码」而不是登录密码。</div>';
  }
  return '<div class="search" style="margin-bottom:10px">' + icon("search") +
      '<input id="mail-search" placeholder="搜索邮件…" value="' + esc(query) + '" /></div>' +
    (inboxError ? '<div class="card" style="border-color:color-mix(in srgb, var(--danger) 30%, transparent)"><div class="small" style="color:var(--danger)">' + esc(inboxError) + '</div></div>' : "") +
    (busy || loadingInbox ? '<div class="card tight"><div class="skeleton" style="height:14px;width:60%"></div><div class="skeleton" style="height:10px;width:85%;margin-top:8px"></div></div>' : "") +
    (inbox.length ? '<div class="list">' + inbox.map((m) =>
      '<div class="list-item" data-mail="' + esc(m.id) + '">' +
        (!m.read ? '<div class="unread-dot"></div>' : '<div style="width:8px"></div>') +
        '<div class="li-body"><div class="li-title" style="font-weight:' + (m.read ? 500 : 700) + '">' + esc(m.subject || "(无主题)") + "</div>" +
          '<div class="li-sub">' + esc(m.from || "") + " · " + esc(m.snippet || "") + "</div></div>" +
        '<div class="li-trail" style="flex-direction:column;align-items:flex-end;gap:4px">' +
          '<span>' + esc(shortDate(m.date)) + "</span>" +
          (m.attachments && m.attachments.length ? icon("paperclip") : "") +
        "</div></div>").join("") + "</div>"
      : busy ? "" : '<div class="card">' + emptyState("mail", inboxError ? "没能取到邮件" : "收件箱是空的", inboxError ? "" : "新邮件会显示在这里。") + "</div>") +
    '<div class="row" style="margin-top:12px;gap:8px"><button class="btn small ghost" id="mail-add-acc">' + icon("plus") + "添加账户</button>" +
      '<span class="spacer"></span><button class="btn small ghost" id="mail-setup">' + icon("settings") + "账户设置</button></div>";
}

function outboxHtml() {
  const list = allOutbox;
  if (!list.length) {
    return '<div class="card">' + emptyState("send", "发件箱是空的", "写一封信，或者用「工作汇报」把这一周的完成情况发出去。",
      '<button class="btn small primary" id="outbox-write">写一封信</button>') + "</div>";
  }
  return '<div class="stack">' + list.map((m) =>
    '<div class="card tight" data-out="' + m.id + '" style="cursor:pointer">' +
      '<div class="row" style="gap:8px"><span class="badge ' + (STATUS[m.status] ? STATUS[m.status].cls : "") + '">' + (STATUS[m.status] || {}).label + "</span>" +
        '<span class="spacer"></span><span class="tiny faint">' + esc(shortDate(m.createdAt)) + "</span></div>" +
      '<div class="ev-title" style="margin-top:8px">' + esc(m.subject || "(无主题)") + "</div>" +
      '<div class="ev-meta">' + esc(m.to || "（没有收件人）") + "</div>" +
      (m.error ? '<div class="tiny" style="color:var(--danger);margin-top:6px">' + esc(m.error) + "</div>" : "") +
      '<div class="row" style="margin-top:10px;gap:8px">' +
        (m.status === "failed" ? '<button class="btn tiny primary" data-retry="' + m.id + '">重试</button>' : "") +
        (m.status === "draft" ? '<button class="btn tiny soft" data-edit="' + m.id + '">继续编辑</button>' : "") +
        '<span class="spacer"></span><button class="btn tiny ghost" data-delout="' + m.id + '" style="color:var(--danger)">删除</button>' +
      "</div></div>").join("") + "</div>";
}

function reportHtml() {
  return '<div class="card tint">' +
    '<div class="row"><span class="card-ico">' + icon("send") + '</span><span class="card-title">工作汇报</span></div>' +
    '<div class="small muted" style="margin-top:8px;line-height:1.6">勾选这一周的日程，自动生成「我完成了什么任务 / 我完成了什么结果」，可以先用 AI 润色，再通过你的 SMTP 发出去。</div>' +
    '<button class="btn primary block" style="margin-top:14px" id="open-report">打开工作汇报</button></div>' +
    '<div class="section-title"><span>最近汇报</span></div>' +
    '<div class="list">' + (reportMails.length ? reportMails.map((m) =>
      '<div class="list-item" data-out="' + m.id + '"><div class="li-ico">' + icon("send") + "</div>" +
      '<div class="li-body"><div class="li-title">' + esc(m.subject) + "</div><div class=\"li-sub\">" + esc(m.to) + " · " + esc(shortDate(m.createdAt)) + "</div></div>" +
      '<div class="li-trail"><span class="badge ' + (STATUS[m.status] || {}).cls + '">' + (STATUS[m.status] || {}).label + "</span></div></div>").join("")
      : '<div class="list-item"><div class="li-body"><div class="li-sub">还没有发过汇报</div></div></div>') + "</div>";
}

let allOutbox = [];
let reportMails = [];

function bindInbox() {
  const search = rootEl.querySelector("#mail-search");
  if (search) search.addEventListener("input", debounce((e) => { query = e.target.value; fetchInbox(); }, 350));
  rootEl.querySelectorAll("[data-mail]").forEach((n) => n.onclick = () => {
    const row = inbox.find((m) => m.id === n.dataset.mail);
    if (row) openMessage(row);
  });
  const add = rootEl.querySelector("#mail-add-acc");
  if (add) add.onclick = () => openAccountEditor(null);
  const setup = rootEl.querySelector("#mail-setup");
  if (setup) setup.onclick = () => openAccounts();
}
function bindOutbox() {
  const write = rootEl.querySelector("#outbox-write");
  if (write) write.onclick = () => openCompose({});
  rootEl.querySelectorAll("[data-out]").forEach((n) => n.onclick = async (e) => {
    if (e.target.closest("button")) return;
    const m = await db.get("mails", n.dataset.out);
    if (m) openCompose({ mail: m });
  });
  rootEl.querySelectorAll("[data-retry]").forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    const m = await db.get("mails", b.dataset.retry);
    if (m) sendStored(m);
  });
  rootEl.querySelectorAll("[data-edit]").forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    const m = await db.get("mails", b.dataset.edit);
    if (m) openCompose({ mail: m });
  });
  rootEl.querySelectorAll("[data-delout]").forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    const ok = await confirmDialog({ title: "删除", message: "从发件箱里删掉这条记录。", ok: "删除", danger: true });
    if (!ok) return;
    await db.del("mails", b.dataset.delout);
    await reload(true);
  });
}
function bindReport() {
  const b = rootEl.querySelector("#open-report");
  if (b) b.onclick = () => navigate("report");
  rootEl.querySelectorAll("[data-out]").forEach((n) => n.onclick = async () => {
    const m = await db.get("mails", n.dataset.out);
    if (m) openCompose({ mail: m, readonly: true });
  });
}

/* 更新发件箱数据（paint 前调用） */
async function refreshOutbox() {
  const list = await db.all("mails");
  allOutbox = list.filter((m) => m.folder === "outbox").sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  reportMails = allOutbox.filter((m) => m.isReport).slice(0, 5);
}

function shortDate(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toTimeString().slice(0, 5);
  return (d.getMonth() + 1) + "/" + d.getDate();
}

/* ---------------- 收件 ---------------- */
async function fetchInbox() {
  if (!bridgeOk || !accountId || getRoute() !== "mail") return;
  loadingInbox = true;
  inboxError = "";
  paint(true);
  try {
    const q = query ? "&query=" + encodeURIComponent(query) : "";
    const data = ensureOk(await bridgeFetch("/api/mail/inbox?accountId=" + encodeURIComponent(accountId) + "&limit=40" + q, undefined, { method: "GET", timeout: 45000, base: mailBase() }));
    const items = (data.items || []).map((it) => ({
      id: "inbox:" + accountId + ":" + it.uid,
      folder: "inbox",
      accountId,
      uid: it.uid,
      subject: it.subject,
      from: it.from || it.fromAddress,
      fromAddress: it.fromAddress,
      to: it.to,
      date: it.date,
      read: it.seen ? 1 : 0,
      flagged: it.flagged ? 1 : 0,
      size: it.size,
      snippet: "",
    }));
    for (const row of inbox) {
      if (!items.some((it) => it.id === row.id)) await db.del("mails", row.id);
    }
    for (const row of items) await db.put("mails", row);
    inbox = items;
    window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "mails" } }));
  } catch (e) {
    inboxError = e.message || String(e);
  } finally {
    loadingInbox = false;
    paint();
  }
}

/* ---------------- 读信 ---------------- */
async function openMessage(summary) {
  let cacheKey = "msg:" + summary.accountId + ":" + summary.uid;
  const cached = await db.get("mails", cacheKey);
  const sheet = openSheet({
    title: "邮件",
    full: true,
    build(body, api) {
      body.innerHTML = '<div class="skeleton" style="height:20px;width:70%"></div>' +
        '<div class="skeleton" style="height:12px;width:50%;margin-top:10px"></div>' +
        '<div class="skeleton" style="height:220px;margin-top:16px"></div>';
      renderMessageBody(body, summary, cached, api).catch((e) => {
        body.innerHTML = '<div class="card"><div class="small" style="color:var(--danger)">' + esc(e.message || e) + "</div></div>";
      });
    },
  });
  if (summary.read === 0) {
    await db.put("mails", { ...summary, read: 1 });
    if (bridgeOk) bridgeFetch("/api/mail/flags", { accountId: summary.accountId, uid: summary.uid, folder: "INBOX", seen: true }, { base: mailBase() }).then(ensureOk).catch(() => {});
    window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "mails" } }));
    inbox = inbox.map((m) => m.id === summary.id ? { ...m, read: 1 } : m);
  }
}

async function renderMessageBody(body, summary, cached, api) {
  let data = cached && cached.payload ? cached.payload : null;
  let error = "";
  if (bridgeOk) {
    try {
      data = ensureOk(await bridgeFetch("/api/mail/message?accountId=" + encodeURIComponent(summary.accountId) + "&uid=" + summary.uid + "&folder=INBOX", undefined, { method: "GET", timeout: 50000, base: mailBase() }));
      await db.put("mails", { ...summary, id: "msg:" + summary.accountId + ":" + summary.uid, folder: "cache", payload: data, read: 1 });
    } catch (e) { error = e.message || String(e); }
  }
  if (!data) {
    body.innerHTML = '<div class="card"><div class="small" style="color:var(--danger)">' + esc(error || "没有本地服务，读不到正文") + "</div></div>";
    return;
  }
  const html = sanitizeMailHtml(data.html || "");
  body.innerHTML =
    '<div><div style="font-size:17px;font-weight:700;line-height:1.45">' + esc(data.subject || summary.subject) + "</div>" +
    '<div class="small muted" style="margin-top:8px">' + esc(data.from || summary.from) + "</div>" +
    '<div class="tiny faint" style="margin-top:2px">' + esc(data.date ? new Date(data.date).toLocaleString("zh-CN") : "") + "</div>" +
    (data.to ? '<div class="tiny faint">收件人：' + esc(data.to) + "</div>" : "") + "</div>" +
    "<hr class='divider' />" +
    (html ? '<div class="mail-html" id="mail-html">' + html + "</div>" : '<pre class="mail-html" style="white-space:pre-wrap;font-family:var(--font-ui)">' + esc(data.text || "") + "</pre>") +
    ((data.attachments || []).filter((a) => !a.inline).length
      ? '<div class="section-title"><span>附件 ' + data.attachments.filter((a) => !a.inline).length + "</span></div><div class='att-grid'>" +
        data.attachments.filter((a) => !a.inline).map((a) =>
          '<a class="att-card" href="' + attachmentUrl(summary, a.index) + '" target="_blank" rel="noopener">' +
          '<span class="ext">' + esc(extOf(a.filename)) + "</span><span><b style=\"font-weight:600\">" + esc(a.filename) + "</b><br><span class=\"tiny faint\">" + formatBytes(a.size) + "</span></span></a>").join("") + "</div>"
      : "") +
    '<div class="btn-row" style="margin-top:16px"><button class="btn soft" id="m-reply">回复</button>' +
      '<button class="btn ghost" id="m-forward">转发</button></div>';

  body.querySelectorAll("#mail-html a").forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
  body.querySelector("#m-reply").onclick = () => {
    api.close();
    openCompose({
      to: data.fromAddress || "", subject: data.subject ? "Re: " + data.subject : "",
      body: "\n\n—— 原邮件 ——\n" + (data.text || "").slice(0, 2000),
    });
  };
  body.querySelector("#m-forward").onclick = () => {
    api.close();
    openCompose({
      subject: data.subject ? "Fwd: " + data.subject : "",
      body: "\n\n—— 转发的邮件 ——\n" + (data.text || "").slice(0, 4000),
    });
  };
}

function extOf(name) {
  const m = String(name || "").match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toUpperCase() : "FILE";
}
function attachmentUrl(summary, index) {
  return mailBase() + "/api/mail/attachment?accountId=" + encodeURIComponent(summary.accountId) + "&uid=" + summary.uid + "&index=" + index + "&folder=INBOX";
}

export function sanitizeMailHtml(html) {
  if (!html) return "";
  if (!window.DOMPurify) return html;
  return window.DOMPurify.sanitize(html, {
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "meta", "link"],
    FORBID_ATTR: ["onerror", "onload", "onclick"],
    ADD_ATTR: ["target", "rel"],
  });
}

/* ---------------- 写信 ---------------- */
let composeDraft = null;

export function openCompose({ mail = null, to = "", subject = "", body = "", attachments = [], readonly = false } = {}) {
  const isDraft = mail && mail.status === "draft";
  const cur = mail ? { ...mail } : {
    id: uid(), folder: "outbox", status: "draft",
    to: to || getSetting("reportTo", ""), cc: "", subject: subject || "",
    text: body || "", attachments: attachments || [], createdAt: Date.now(),
  };
  let files = (cur.attachments || []).filter((a) => a.contentBase64).map((a) => ({ ...a }));
  if (body && !mail) { cur.text = body; }
  const sheet = openSheet({
    title: readonly ? "邮件详情" : (isDraft ? "编辑草稿" : "写邮件"),
    full: true,
    footer: true,
    build(b, api) {
      b.innerHTML =
        (accounts.length ? '<div class="field"><label>发件账户</label><select class="input" id="c-acc">' +
          accounts.map((a) => '<option value="' + a.id + '">' + esc(a.name || a.email) + " · " + esc(a.email) + "</option>").join("") +
          "</select></div>" : '<div class="hint">还没有配置邮箱账户，发送前请先在「设置 → 邮箱」里添加。</div>') +
        '<div class="field"><label>收件人</label><input class="input" id="c-to" placeholder="someone@example.com" value="' + esc(cur.to || "") + '" /></div>' +
        '<div class="field"><label>抄送（可空）</label><input class="input" id="c-cc" value="' + esc(cur.cc || "") + '" /></div>' +
        '<div class="field"><label>主题</label><input class="input" id="c-subject" value="' + esc(cur.subject || "") + '" placeholder="主题" /></div>' +
        '<div class="field"><label>正文</label><textarea class="textarea" id="c-body" style="min-height:190px" placeholder="写点什么…">' + esc(cur.text || "") + "</textarea></div>" +
        '<div class="attach-row" id="c-files"></div>' +
        (!readonly ? '<div class="row" style="gap:8px"><button class="btn small ghost" id="c-attach" style="flex:0 0 auto">' + icon("paperclip") + "附件</button>" +
          '<span class="tiny faint">支持图片 / PDF / 文档，单封信不超过 20MB</span></div>' : "") +
        (cur.error ? '<div class="small" style="color:var(--danger)">' + esc(cur.error) + "</div>" : "");
      const accSel = b.querySelector("#c-acc");
      if (accSel && cur.accountId) accSel.value = cur.accountId;
      const paintFiles = () => {
        const row = b.querySelector("#c-files");
        if (!row) return;
        row.innerHTML = files.map((f, i) => '<span class="attach-chip">' + icon("file") + esc(f.filename) +
          '<span class="tiny faint">' + formatBytes(f.size) + '</span><span class="x" data-f="' + i + '">✕</span></span>').join("");
        row.querySelectorAll("[data-f]").forEach((x) => x.onclick = () => { files.splice(Number(x.dataset.f), 1); paintFiles(); });
      };
      paintFiles();
      const attach = b.querySelector("#c-attach");
      if (attach) attach.onclick = async () => {
        const input = document.createElement("input");
        input.type = "file"; input.multiple = true;
        input.onchange = async () => {
          for (const f of Array.from(input.files || [])) {
            if (f.size > 10 * 1024 * 1024) { toast(f.name + " 太大（上限 10MB）", "err"); continue; }
            const dataUrl = await readFile(f, "dataurl");
            files.push({ filename: f.name, contentType: f.type || "application/octet-stream", size: f.size, contentBase64: String(dataUrl).split(",")[1] || "" });
          }
          paintFiles();
        };
        input.click();
      };
      const foot = api.foot;
      foot.innerHTML = "";
      if (readonly) {
        const close = el('<button class="btn ghost">关闭</button>');
        close.onclick = () => api.close();
        foot.appendChild(close);
        return;
      }
      const saveDraft = el('<button class="btn ghost" style="flex:0 0 auto">存草稿</button>');
      saveDraft.onclick = async () => {
        const draft = collect();
        draft.status = "draft";
        await db.put("mails", draft);
        toast("已保存草稿");
        api.close();
        await reload(true);
      };
      const send = el('<button class="btn primary">发送</button>');
      send.onclick = async () => {
        const draft = collect();
        if (!draft.to.trim()) { toast("先填写收件人", "err"); return; }
        if (!bridgeOk) { toast("需要先启动本地服务", "err"); return; }
        await db.put("mails", { ...draft, status: "sending", error: "" });
        send.disabled = true;
        send.textContent = "发送中…";
        try {
          ensureOk(await bridgeFetch("/api/mail/send", {
            accountId: draft.accountId || undefined,
            to: draft.to, cc: draft.cc, subject: draft.subject,
            text: draft.text, html: textToHtml(draft.text),
            attachments: draft.attachments,
          }, { timeout: 60000, base: mailBase() }));
          await db.put("mails", { ...draft, status: "sent", sentAt: Date.now(), error: "" });
          toast("已发送", "ok");
          api.close();
          await reload(true);
        } catch (e) {
          await db.put("mails", { ...draft, status: "failed", error: e.message || String(e) });
          toast("发送失败：" + (e.message || e), "err");
          send.disabled = false;
          send.textContent = "重试发送";
        }
      };
      foot.append(saveDraft, send);
      function collect() {
        return {
          ...cur,
          id: cur.id,
          folder: "outbox",
          accountId: accSel ? accSel.value : cur.accountId,
          to: b.querySelector("#c-to").value.trim(),
          cc: b.querySelector("#c-cc").value.trim(),
          subject: b.querySelector("#c-subject").value.trim(),
          text: b.querySelector("#c-body").value,
          attachments: files,
          updatedAt: Date.now(),
        };
      }
    },
  });
  return sheet;
}

export function textToHtml(text) {
  const esc2 = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paras = String(text || "").split(/\n{2,}/).map((p) => "<p>" + esc2(p).replace(/\n/g, "<br>") + "</p>");
  return '<div style="font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',\'Microsoft YaHei\',sans-serif;font-size:15px;line-height:1.7;color:#222">' + paras.join("") + "</div>";
}

async function sendStored(m) {
  if (!bridgeOk) { toast("需要先启动本地服务", "err"); return; }
  toast("正在重试发送…");
  try {
    ensureOk(await bridgeFetch("/api/mail/send", {
      accountId: m.accountId || undefined, to: m.to, cc: m.cc, subject: m.subject,
      text: m.text, html: textToHtml(m.text), attachments: m.attachments || [],
    }, { timeout: 60000, base: mailBase() }));
    await db.put("mails", { ...m, status: "sent", sentAt: Date.now(), error: "" });
    toast("已发送", "ok");
  } catch (e) {
    await db.put("mails", { ...m, status: "failed", error: e.message || String(e) });
    toast("还是失败：" + (e.message || e), "err");
  }
  await reload(true);
}

/* ---------------- 账户 ---------------- */
function openAccounts() {
  openSheet({
    title: "邮箱账户",
    build(body, api) {
      const paintList = () => {
        body.innerHTML =
          (accounts.length ? '<div class="list">' + accounts.map((a) =>
            '<div class="list-item"><div class="li-ico">' + icon("mail") + '</div><div class="li-body"><div class="li-title">' + esc(a.name) + "</div>" +
            '<div class="li-sub">' + esc(a.email) + " · " + esc(a.imap.host || "未填 IMAP") + "</div></div>" +
            '<button class="icon-btn plain" data-edit="' + a.id + '">' + icon("edit") + "</button></div>").join("") + "</div>"
          : "<div class='hint'>还没有账户</div>") +
          '<button class="btn primary block" style="margin-top:14px" id="acc-add">添加邮箱账户</button>' +
          '<div class="hint" style="margin-top:10px">账户保存在本机，密码用 Android Keystore 加密。QQ / 163 / 126 用授权码；Gmail 用应用专用密码；Outlook 多数租户已禁用基础认证。IMAP 一般 993（SSL），SMTP 一般 465（SSL）或 587（STARTTLS）。</div>';
        body.querySelectorAll("[data-edit]").forEach((n) => n.onclick = () => {
          const acc = accounts.find((a) => a.id === n.dataset.edit);
          api.close(); openAccountEditor(acc);
        });
        body.querySelector("#acc-add").onclick = () => { api.close(); openAccountEditor(null); };
      };
      paintList();
    },
  });
}

function openAccountEditor(acc) {
  const cur = acc || { name: "", email: "", imap: { host: "", port: 993, secure: true, user: "" }, smtp: { host: "", port: 465, secure: true, user: "", fromName: "" } };
  openSheet({
    title: acc ? "编辑邮箱账户" : "添加邮箱账户",
    full: true,
    footer: true,
    build(body, api) {
      body.innerHTML =
        '<div class="chips" style="margin-bottom:10px">' +
          ["qq|QQ 邮箱", "163|163 邮箱", "126|126 邮箱", "gmail|Gmail"].map((x) => {
            const [k, label] = x.split("|");
            return '<button class="chip" data-preset="' + k + '">' + label + "</button>";
          }).join("") +
        "</div>" +
        '<div class="hint" id="a-preset-hint" style="margin-bottom:10px">选一个常用邮箱可自动填服务器；也可以手动填写。</div>' +
        '<div class="field"><label>显示名称</label><input class="input" id="a-name" value="' + esc(cur.name || "") + '" placeholder="例如：学校邮箱" /></div>' +
        '<div class="field"><label>邮箱地址</label><input class="input" id="a-email" type="email" value="' + esc(cur.email || "") + '" placeholder="you@example.com" /></div>' +
        '<div class="section-title"><span>收件（IMAP）</span></div>' +
        '<div class="field"><label>服务器</label><input class="input" id="a-imap-host" value="' + esc(cur.imap.host || "") + '" placeholder="imap.qq.com" /></div>' +
        '<div class="input-row"><div class="field"><label>端口</label><input class="input" id="a-imap-port" type="number" value="' + (cur.imap.port || 993) + '" /></div>' +
        '<div class="field"><label>加密</label><select class="input" id="a-imap-secure"><option value="1">SSL / TLS</option><option value="0">不加密</option></select></div></div>' +
        '<div class="field"><label>账号</label><input class="input" id="a-imap-user" value="' + esc(cur.imap.user || "") + '" placeholder="默认与邮箱地址相同" /></div>' +
        '<div class="field"><label>密码 / 授权码</label><input class="input" id="a-imap-pass" type="password" placeholder="' + (cur.imap.hasPass ? "已保存，留空则不修改" : "授权码") + '" /></div>' +
        '<div class="section-title"><span>发件（SMTP）</span></div>' +
        '<div class="field"><label>服务器</label><input class="input" id="a-smtp-host" value="' + esc(cur.smtp.host || "") + '" placeholder="smtp.qq.com" /></div>' +
        '<div class="input-row"><div class="field"><label>端口</label><input class="input" id="a-smtp-port" type="number" value="' + (cur.smtp.port || 465) + '" /></div>' +
        '<div class="field"><label>加密</label><select class="input" id="a-smtp-secure"><option value="1">SSL / TLS</option><option value="0">STARTTLS / 不加密</option></select></div></div>' +
        '<div class="field"><label>账号</label><input class="input" id="a-smtp-user" value="' + esc(cur.smtp.user || "") + '" placeholder="默认与邮箱地址相同" /></div>' +
        '<div class="field"><label>密码 / 授权码</label><input class="input" id="a-smtp-pass" type="password" placeholder="' + (cur.smtp.hasPass ? "已保存，留空则不修改" : "授权码") + '" /></div>' +
        '<div class="field"><label>发件人显示名</label><input class="input" id="a-from-name" value="' + esc(cur.smtp.fromName || "") + '" placeholder="例如：张三" /></div>' +
        '<div class="hint" id="a-test-result"></div>' +
        (acc ? '<button class="btn ghost block" id="a-del" style="color:var(--danger)">删除这个账户</button>' : "");
      body.querySelector("#a-imap-secure").value = cur.imap.secure === false ? "0" : "1";
      body.querySelector("#a-smtp-secure").value = cur.smtp.secure === false ? "0" : "1";
      const presets = {
        qq: ["imap.qq.com", 993, "smtp.qq.com", 465, true, "QQ 邮箱：网页版设置 → 账户 → 开启 IMAP/SMTP，生成授权码填到密码里。"],
        "163": ["imap.163.com", 993, "smtp.163.com", 465, true, "163 邮箱：设置 → POP3/SMTP/IMAP → 开启 IMAP，使用授权码。"],
        "126": ["imap.126.com", 993, "smtp.126.com", 465, true, "126 邮箱：设置 → POP3/SMTP/IMAP → 开启 IMAP，使用授权码。"],
        gmail: ["imap.gmail.com", 993, "smtp.gmail.com", 587, false, "Gmail：开启两步验证 → 应用专用密码；SMTP 用 587 + STARTTLS。"],
      };
      body.querySelectorAll("[data-preset]").forEach((btn) => btn.onclick = () => {
        const p = presets[btn.dataset.preset];
        if (!p) return;
        body.querySelector("#a-imap-host").value = p[0];
        body.querySelector("#a-imap-port").value = String(p[1]);
        body.querySelector("#a-imap-secure").value = "1";
        body.querySelector("#a-smtp-host").value = p[2];
        body.querySelector("#a-smtp-port").value = String(p[3]);
        body.querySelector("#a-smtp-secure").value = p[4] ? "1" : "0";
        body.querySelector("#a-preset-hint").textContent = p[5];
        body.querySelectorAll("[data-preset]").forEach((b) => b.classList.toggle("active", b === btn));
      });
      const foot = api.foot;
      foot.innerHTML = "";
      const test = el('<button class="btn ghost" style="flex:0 0 auto">测试</button>');
      test.onclick = async () => {
        const draft = collect();
        if (!bridgeOk) { toast("需要先启动本地服务", "err"); return; }
        test.disabled = true; test.textContent = "测试中…";
        try {
          const r = ensureOk(await bridgeFetch("/api/mail/test", { account: draft }, { timeout: 45000, base: mailBase() }));
          const parts = [];
          if (r.imap) parts.push("IMAP " + (r.imap.ok ? "✓ 正常" : "✗ " + r.imap.error));
          if (r.smtp) parts.push("SMTP " + (r.smtp.ok ? "✓ 正常" : "✗ " + r.smtp.error));
          body.querySelector("#a-test-result").textContent = parts.join("；");
        } catch (e) {
          body.querySelector("#a-test-result").textContent = "测试失败：" + (e.message || e);
        } finally { test.disabled = false; test.textContent = "测试"; }
      };
      const save = el('<button class="btn primary">保存</button>');
      save.onclick = async () => {
        const draft = collect();
        if (!draft.email) { toast("先填邮箱地址", "err"); return; }
        if (!bridgeOk) { toast("需要先启动本地服务", "err"); return; }
        try {
          ensureOk(await bridgeFetch("/api/mail/accounts", { account: draft }, { timeout: 20000, base: mailBase() }));
          toast("账户已保存", "ok");
          api.close();
          await reload(true);
        } catch (e) { toast("保存失败：" + (e.message || e), "err"); }
      };
      foot.append(test, save);
      const del = body.querySelector("#a-del");
      if (del) del.onclick = async () => {
        const ok = await confirmDialog({ title: "删除账户", message: "只删除本机的账户配置。", ok: "删除", danger: true });
        if (!ok) return;
        ensureOk(await bridgeFetch("/api/mail/accounts/delete", { id: acc.id }, { base: mailBase() }));
        toast("已删除");
        api.close();
        await reload(true);
      };
      function collect() {
        const val = (id) => body.querySelector("#" + id).value.trim();
        return {
          id: acc ? acc.id : undefined,
          name: val("a-name"), email: val("a-email"),
          imap: { host: val("a-imap-host"), port: Number(val("a-imap-port")) || 993, secure: body.querySelector("#a-imap-secure").value === "1", user: val("a-imap-user") || val("a-email"), pass: body.querySelector("#a-imap-pass").value },
          smtp: { host: val("a-smtp-host"), port: Number(val("a-smtp-port")) || 465, secure: body.querySelector("#a-smtp-secure").value === "1", user: val("a-smtp-user") || val("a-email"), pass: body.querySelector("#a-smtp-pass").value, fromName: val("a-from-name") },
        };
      }
    },
  });
}

function debounce(fn, ms) {
  let t = 0;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
