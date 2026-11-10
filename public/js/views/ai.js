/* AI 助手：流式对话、思考过程、工具调用、会话历史 */
import { db, getSetting, setSetting } from "../db.js";
import { setHeader, navigate } from "../shell.js";
import { icon } from "../icons.js";
import { esc, toast, openSheet, actionSheet, confirmDialog, promptDialog, qs, el, autoGrow, emptyState } from "../ui.js";
import { mdToHtml, renderMath } from "../markdown.js";
import { streamChat, aiConfig, hasKey } from "../ai.js";
import { TOOL_DEFS, executeTool } from "../tools.js";
import { uid, fmtRelative, readFile, formatBytes } from "../util.js";

let rootEl = null;
let session = null;
let sessions = [];
let messages = [];
let abortCtrl = null;
let busy = false;
let attachments = [];
let scroller = null;
let autoScroll = true;

const SUGGESTIONS = [
  { t: "今天有什么安排？", i: "calendar" },
  { t: "帮我安排明天下午的学习计划", i: "sparkles" },
  { t: "把这段文字整理成周报", i: "send" },
  { t: "解释一下贝叶斯公式", i: "sigma" },
];

export async function render(root, ctx) {
  rootEl = root;
  root.style.cssText = "padding:0;display:flex;flex-direction:column;overflow:hidden";
  sessions = await db.all("chats");
  sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  session = null;
  messages = [];
  attachments = [];

  const modelName = getSetting("apiModel", "");
  setHeader("Lume", "AI 助手" + (modelName ? " · " + modelName : ""), [
    { icon: "plus", title: "新对话", onClick: () => newChat() },
    { icon: "more-horizontal", title: "菜单", onClick: () => openMenu() },
  ]);
  paintShell();
  const ask = ctx && ctx.params && ctx.params.ask;
  if (ask) {
    setTimeout(() => send(ask), 350);
  }
  return () => { if (abortCtrl) abortCtrl.abort(); };
}

/* ---------------- 外壳 ---------------- */
function paintShell() {
  rootEl.innerHTML =
    '<div id="chat-scroll" style="flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;padding:8px 14px 14px">' +
      '<div id="chat-messages" class="chat-wrap"></div>' +
    "</div>" +
    '<div class="chat-input-bar" style="margin:0;padding:10px 14px calc(var(--safe-b) + 10px)">' +
      '<button class="icon-btn" id="chat-attach" title="附件" style="height:42px;width:42px;border-radius:14px">' + icon("paperclip") + "</button>" +
      '<div style="flex:1;min-width:0">' +
        '<div class="attach-row" id="chat-attachments"></div>' +
        '<textarea class="chat-input" id="chat-text" rows="1" placeholder="问点什么…"></textarea>' +
      "</div>" +
      '<button class="send-btn" id="chat-send" aria-label="发送">' + icon("arrow-up") + "</button>" +
    "</div>" +
    '<button class="btn small ghost" id="jump-bottom" hidden style="position:absolute;bottom:120px;left:50%;transform:translateX(-50%);z-index:20;box-shadow:var(--shadow)">回到底部</button>';

  scroller = qs("#chat-scroll", rootEl);
  const input = qs("#chat-text", rootEl);
  autoGrow(input);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doSend(); }
  });
  input.addEventListener("paste", async (e) => {
    const items = Array.from(e.clipboardData && e.clipboardData.items || []);
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) addAttachment(file);
      }
    }
  });
  qs("#chat-send", rootEl).onclick = () => (busy ? stop() : doSend());
  qs("#chat-attach", rootEl).onclick = () => pickAttachments();
  scroller.addEventListener("scroll", () => {
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    autoScroll = nearBottom;
    qs("#jump-bottom", rootEl).hidden = nearBottom || scroller.scrollHeight < scroller.clientHeight + 100;
  });
  qs("#jump-bottom", rootEl).onclick = () => scrollToBottom(true);
  paintMessages();
}

function paintMessages() {
  const box = qs("#chat-messages", rootEl);
  if (!box) return;
  if (!messages.length) {
    box.innerHTML = welcomeHtml();
    box.querySelectorAll("[data-suggest]").forEach((b) => b.onclick = () => send(b.dataset.suggest));
    box.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => navigate(b.dataset.go));
    return;
  }
  box.innerHTML = messages.map((m, i) => messageHtml(m, i)).join("");
  messages.forEach((m, i) => {
    if (m.role === "assistant") {
      const node = box.querySelector('[data-mid="' + i + '"] .md');
      if (node) {
        node.innerHTML = mdToHtml(m.content || "");
        if (!busy || i !== messages.length - 1) renderMath(node);
      }
    }
  });
  box.querySelectorAll(".think-head").forEach((h) => {
    h.onclick = () => h.parentElement.classList.toggle("open");
  });
  box.querySelectorAll("[data-copy]").forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const idx = Number(b.dataset.copy);
      try { await navigator.clipboard.writeText(messages[idx].content || ""); toast("已复制", "ok"); } catch { toast("复制失败", "err"); }
    };
  });
  scrollToBottom(false);
}

function welcomeHtml() {
  const cfg = aiConfig();
  return '<div class="card" style="background:linear-gradient(145deg, color-mix(in srgb, var(--accent) 13%, var(--surface)), var(--surface) 72%);margin-top:6px">' +
    '<div class="row" style="gap:12px"><div class="avatar" style="width:44px;height:44px;border-radius:15px;background:linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #000));color:#fff;font-size:17px">L</div>' +
    "<div><div style=\"font-size:17px;font-weight:700\">你好，我是 Lume</div>" +
    '<div class="small muted">写作、学习、日程上的事都可以交给我</div></div></div>' +
    '<div class="row" style="gap:6px;margin-top:14px;flex-wrap:wrap"><span class="badge accent">' + esc(cfg.model) + "</span>" +
    '<span class="badge">' + (hasKey() ? "已连接" : "未配置访问密钥") + "</span>" +
    '<span class="badge">' + (getSetting("apiTools", "1") === "1" ? "可以动手" : "只聊天") + "</span></div>" +
    (hasKey() ? "" : '<button class="btn soft block" style="margin-top:14px" data-go="settings">去配置 AI 设置</button>') +
    "</div>" +
    '<div class="section-title" style="margin-top:6px"><span>试试这些</span></div>' +
    '<div class="stack">' + SUGGESTIONS.map((s) =>
      '<button class="list-item" data-suggest="' + esc(s.t) + '" style="border:1px solid var(--line);border-radius:14px;background:var(--surface);box-shadow:var(--shadow)">' +
        '<div class="li-ico">' + icon(s.i) + '</div><div class="li-body"><div class="li-title" style="font-weight:550">' + esc(s.t) + "</div></div>" +
        '<div class="li-trail">' + icon("arrow-up") + "</div></button>").join("") + "</div>" +
    '<div class="tiny muted center" style="margin-top:10px">内容由模型生成，重要信息请自行核对</div>';
}

function messageHtml(m, i) {
  if (m.role === "user") {
    const imgs = (m.images || []).map((src) => '<img src="' + src + '" style="max-width:150px;border-radius:10px;margin:4px 4px 0 0" alt="" />').join("");
    const files = (m.files || []).map((f) => '<span class="attach-chip">' + icon("file") + esc(f.name) + "</span>").join("");
    let text = esc(m.content || "");
    if (m.content) {
      text = mdToHtml(m.content);
    }
    return '<div class="msg user" data-mid="' + i + '"><div class="avatar">我</div><div class="msg-body">' +
      '<div class="bubble"><div class="md">' + text + "</div>" +
        (imgs || files ? '<div style="margin-top:6px">' + imgs + files + "</div>" : "") +
      "</div>" +
      (m.ts ? '<div class="msg-time">' + esc(new Date(m.ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })) + "</div>" : "") +
      "</div></div>";
  }
  if (m.role === "tool") {
    return '<div class="msg ai" data-mid="' + i + '"><div class="avatar">L</div><div class="msg-body">' +
      '<div class="tool-card"><div class="think-head">' + icon("check") + "<span>已执行 <b>" + esc(m.name || "tool") + "</b></span>" +
      '<span class="spacer"></span><span class="tiny faint">完成</span></div></div></div></div>';
  }
  const thinking = m.reasoning ? '<div class="think-card ' + (m.streaming || m.thinkingOpen ? "open" : "") + '">' +
    '<div class="think-head">' + (m.streaming && !m.content ? '<span class="spin"></span>' : icon("lightbulb")) +
    "<span>思考过程</span><span class=\"spacer\"></span><span class=\"tiny faint\">" + (m.streaming ? "正在思考…" : "已完成") + "</span></div>" +
    '<div class="think-body">' + esc(m.reasoning) + "</div></div>" : "";
  const tools = (m.toolCalls || []).map((t) =>
    '<div class="tool-card"><div class="think-head">' + icon("wand") + "<span>使用了 <b>" + esc(t.function ? t.function.name : t.name) + "</b></span>" +
      '<span class="spacer"></span><span class="tiny faint">工具</span></div></div>').join("");
  return '<div class="msg ai" data-mid="' + i + '"><div class="avatar">L</div><div class="msg-body">' +
    thinking + tools +
    '<div class="bubble"><div class="md">' + (m.content ? "" : (m.streaming ? '<span class="typing"><i></i><i></i><i></i></span>' : "")) + "</div></div>" +
    (m.content && !m.streaming ? '<div class="row" style="gap:6px;margin-top:4px;padding-left:4px">' +
      '<button class="btn tiny ghost" data-copy="' + i + '">' + icon("copy") + "复制</button>" +
      (m.stats ? '<span class="tiny faint">' + esc(m.stats) + "</span>" : "") + "</div>" : "") +
    "</div></div>";
}

function scrollToBottom(force) {
  if (!scroller) return;
  if (force || autoScroll) scroller.scrollTop = scroller.scrollHeight;
}

/* ---------------- 附件 ---------------- */
async function pickAttachments() {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = "image/*,.txt,.md,.csv,.json,.log";
  input.onchange = async () => { for (const f of Array.from(input.files || [])) await addAttachment(f); };
  input.click();
}
async function addAttachment(file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) { toast("文件太大（上限 8MB）", "err"); return; }
  if (file.type.startsWith("image/")) {
    const dataUrl = await readFile(file, "dataurl");
    attachments.push({ type: "image", name: file.name, dataUrl, size: file.size });
  } else {
    const text = await readFile(file, "text").catch(() => "");
    if (!text) { toast("只支持图片和文本文件", "err"); return; }
    attachments.push({ type: "text", name: file.name, text: text.slice(0, 20000), size: file.size });
  }
  paintAttachments();
}
function paintAttachments() {
  const row = qs("#chat-attachments", rootEl);
  if (!row) return;
  row.innerHTML = attachments.map((a, i) =>
    '<span class="attach-chip">' + (a.type === "image"
      ? '<img src="' + a.dataUrl + '" alt="" />'
      : icon("file")) + "<span class=\"ellipsis\">" + esc(a.name) + "</span>" +
      '<span class="x" data-rm="' + i + '">✕</span></span>').join("");
  row.querySelectorAll("[data-rm]").forEach((x) => x.onclick = () => { attachments.splice(Number(x.dataset.rm), 1); paintAttachments(); });
}

/* ---------------- 发送 ---------------- */
function buildApiMessages() {
  const out = [{ role: "system", content: getSetting("systemPrompt", "你是 Lume，写作与学习助手。回答用简体中文。") }];
  for (const m of messages) {
    if (m.role === "user") {
      let content = m.content || "";
      for (const f of m.files || []) content += "\n\n【附件：" + f.name + "】\n" + f.text;
      if (m.images && m.images.length) {
        out.push({ role: "user", content: [
          { type: "text", text: content },
          ...m.images.map((u) => ({ type: "image_url", image_url: { url: u } })),
        ] });
      } else {
        out.push({ role: "user", content });
      }
    } else if (m.role === "assistant") {
      if (!m.content && !(m.toolCalls && m.toolCalls.length)) continue;
      const base = { role: "assistant", content: m.content || "" };
      if (m.reasoning) base.reasoning_content = m.reasoning;
      if (m.toolCalls && m.toolCalls.length) {
        base.content = m.content || null;
        base.tool_calls = m.toolCalls;
      }
      out.push(base);
    } else if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content || "" });
    }
  }
  return out;
}

async function doSend() {
  if (busy) return;
  const input = qs("#chat-text", rootEl);
  const text = (input.value || "").trim();
  if (!text && !attachments.length) return;
  if (!hasKey()) {
    toast("还没有配置访问密钥", "err");
    openMenu();
    return;
  }
  input.value = "";
  input.style.height = "42px";
  send(text);
}

async function send(text) {
  if (busy) return;
  const imgs = attachments.filter((a) => a.type === "image").map((a) => a.dataUrl);
  const files = attachments.filter((a) => a.type === "text").map((a) => ({ name: a.name, text: a.text }));
  attachments = [];
  paintAttachments();
  messages.push({ role: "user", content: text, images: imgs, files, ts: Date.now() });
  await ensureSession(text);
  paintMessages();
  scrollToBottom(true);
  busy = true;
  setSending(true);
  abortCtrl = new AbortController();
  let loop = 0;
  try {
    while (loop < 4) {
      const apiMessages = buildApiMessages();
      const aiMsg = { role: "assistant", content: "", reasoning: "", toolCalls: [], streaming: true, startedAt: 0, chars: 0 };
      messages.push(aiMsg);
      paintMessages();
      const idx = messages.length - 1;
      const node = () => rootEl.querySelector('[data-mid="' + idx + '"]');
      let renderQueued = false;
      let lastRender = 0;
      const scheduleRender = () => {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => {
          renderQueued = false;
          const elNode = node();
          if (!elNode) return;
          const md = elNode.querySelector(".md");
          if (md) {
            md.innerHTML = mdToHtml(aiMsg.content || "");
            if (!busy) renderMath(md);
          }
          const think = elNode.querySelector(".think-body");
          if (think && aiMsg.reasoning) think.textContent = aiMsg.reasoning;
          scrollToBottom(false);
        });
      };
      const t0 = performance.now();
      let firstToken = 0;
      const wantTools = getSetting("apiTools", "1") === "1";
      for await (const evt of streamChat({
        messages: apiMessages,
        tools: wantTools ? TOOL_DEFS : null,
        signal: abortCtrl.signal,
      })) {
        if (evt.type === "reasoning") {
          if (!firstToken) firstToken = performance.now();
          aiMsg.reasoning += evt.text;
          if (getSetting("apiThinking", "1") === "1") scheduleRender();
        } else if (evt.type === "delta") {
          if (!firstToken) firstToken = performance.now();
          aiMsg.content += evt.text;
          scheduleRender();
        } else if (evt.type === "tool") {
          aiMsg.toolCalls = evt.calls.map((c) => ({
            id: c.id, type: "function",
            function: { name: c.name, arguments: c.arguments },
          }));
        } else if (evt.type === "done") {
          aiMsg.usage = evt.usage;
        }
      }
      const elapsed = (performance.now() - t0) / 1000;
      aiMsg.streaming = false;
      if (!aiMsg.reasoning) delete aiMsg.reasoning;
      aiMsg.stats = firstToken
        ? "首字 " + ((firstToken - t0) / 1000).toFixed(2) + "s · " + (aiMsg.content.length / Math.max(elapsed, .3)).toFixed(0) + " 字/秒"
        : "";
      paintMessages();
      const mdNode = rootEl.querySelector('[data-mid="' + idx + '"] .md');
      if (mdNode) renderMath(mdNode);

      if (aiMsg.toolCalls && aiMsg.toolCalls.length && wantTools) {
        for (const call of aiMsg.toolCalls) {
          const name = call.function.name;
          let args = {};
          try { args = JSON.parse(call.function.arguments || "{}"); } catch (e) {}
          const card = el('<div class="tool-card"><div class="think-head"><span class="spin"></span><span>正在执行 <b>' +
            esc(name) + "</b>…</span></div></div>");
          rootEl.querySelector('[data-mid="' + idx + '"] .msg-body').appendChild(card);
          let result = "";
          try { result = await executeTool(name, args); }
          catch (e) { result = JSON.stringify({ error: String(e.message || e) }); }
          card.remove();
          messages.push({ role: "tool", toolCallId: call.id, name, content: result, ts: Date.now() });
        }
        paintMessages();
        loop++;
        continue;
      }
      break;
    }
  } catch (e) {
    if (e.name === "AbortError" || /abort/i.test(String(e.message))) {
      const last = messages[messages.length - 1];
      if (last && last.role === "assistant") { last.streaming = false; last.stats = "已停止"; }
    } else {
      const last = messages[messages.length - 1];
      if (last && last.role === "assistant" && !last.content) messages.pop();
      toast(e.message || "请求失败", "err");
      messages.push({ role: "assistant", content: "**请求失败**：" + (e.message || e), ts: Date.now() });
    }
  } finally {
    busy = false;
    setSending(false);
    abortCtrl = null;
    paintMessages();
    saveSession();
  }
}

function setSending(on) {
  const btn = qs("#chat-send", rootEl);
  if (!btn) return;
  btn.classList.toggle("stop", on);
  btn.innerHTML = on ? icon("stop") : icon("arrow-up");
}
function stop() {
  if (abortCtrl) abortCtrl.abort();
}

async function ensureSession(title) {
  if (session) return session;
  session = {
    id: uid(),
    title: (title || "新对话").slice(0, 24),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  sessions.unshift(session);
  return session;
}
async function saveSession() {
  if (!session) return;
  session.messages = messages;
  session.updatedAt = Date.now();
  const firstUser = messages.find((m) => m.role === "user");
  session.title = session.title && session.title !== "新对话"
    ? session.title
    : (firstUser ? String(firstUser.content || "图片对话").slice(0, 24) : "新对话");
  await db.put("chats", { ...session, messages });
  sessions = sessions.filter((s) => s.id !== session.id);
  sessions.unshift(session);
}

function newChat() {
  if (busy) stop();
  session = null; messages = []; attachments = [];
  paintAttachments();
  paintMessages();
  toast("新对话");
}

/* ---------------- 菜单 ---------------- */
async function openMenu() {
  openSheet({
    title: "Lume 设置",
    build(body, api) {
      const cfg = aiConfig();
      body.innerHTML =
        '<div class="list" style="box-shadow:none">' +
          '<div class="list-item" data-m="history"><div class="li-ico">' + icon("message") + '</div><div class="li-body"><div class="li-title">历史会话</div><div class="li-sub">' + sessions.length + ' 个对话</div></div><div class="li-trail">' + icon("chevron-right") + "</div></div>" +
          '<div class="list-item" data-m="prompt"><div class="li-ico">' + icon("type") + '</div><div class="li-body"><div class="li-title">系统提示词</div><div class="li-sub">决定 Lume 的语气与边界</div></div><div class="li-trail">' + icon("chevron-right") + "</div></div>" +
          '<div class="list-item" data-m="model"><div class="li-ico">' + icon("sparkles") + '</div><div class="li-body"><div class="li-title">模型</div><div class="li-sub">' + esc(cfg.model) + " · 思考强度 " + esc(cfg.effort) + "</div></div><div class=\"li-trail\">" + icon("chevron-right") + "</div></div>" +
          '<div class="list-item" data-m="settings"><div class="li-ico">' + icon("settings") + '</div><div class="li-body"><div class="li-title">AI 接口设置</div><div class="li-sub">API 地址、Key、模型</div></div><div class="li-trail">' + icon("chevron-right") + "</div></div>" +
        "</div>" +
        '<div class="card flat" style="margin-top:12px">' +
          '<div class="toggle-row"><div class="tr-body"><div class="tr-title">让 AI 动手</div><div class="tr-sub">允许 Lume 新建日程、写备忘、查安排</div></div>' +
            '<label class="switch"><input type="checkbox" id="m-tools" ' + (getSetting("apiTools", "1") === "1" ? "checked" : "") + '><span></span></label></div>' +
          '<div class="divider"></div>' +
          '<div class="toggle-row"><div class="tr-body"><div class="tr-title">显示思考过程</div><div class="tr-sub">推理模型会把思考卡片展示出来</div></div>' +
            '<label class="switch"><input type="checkbox" id="m-think" ' + (getSetting("apiThinking", "1") === "1" ? "checked" : "") + '><span></span></label></div>' +
        "</div>" +
        '<div class="btn-row" style="margin-top:14px">' +
          '<button class="btn ghost" id="m-clear">清空当前对话</button>' +
          '<button class="btn danger" id="m-del">删除当前对话</button>' +
        "</div>";
      body.querySelectorAll("[data-m]").forEach((n) => n.onclick = async () => {
        const m = n.dataset.m;
        if (m === "history") { api.close(); openHistory(); }
        else if (m === "prompt") { api.close(); editPrompt(); }
        else if (m === "model") { api.close(); pickModel(); }
        else if (m === "settings") { api.close(); navigate("settings", { card: "ai" }); }
      });
      body.querySelector("#m-tools").onchange = async (e) => { await setSetting("apiTools", e.target.checked ? "1" : "0"); toast(e.target.checked ? "已开启：AI 可以动手" : "已关闭工具"); };
      body.querySelector("#m-think").onchange = async (e) => { await setSetting("apiThinking", e.target.checked ? "1" : "0"); };
      body.querySelector("#m-clear").onclick = async () => {
        if (!messages.length) { toast("当前没有对话"); return; }
        const ok = await confirmDialog({ title: "清空当前对话", message: "只清空界面上的对话，历史会话里仍可找回。", ok: "清空" });
        if (!ok) return;
        messages = []; paintMessages(); api.close();
      };
      body.querySelector("#m-del").onclick = async () => {
        if (!session) { toast("当前没有对话"); return; }
        const ok = await confirmDialog({ title: "删除当前对话", message: "会从历史会话里删掉。", ok: "删除", danger: true });
        if (!ok) return;
        await db.del("chats", session.id);
        sessions = sessions.filter((s) => s.id !== session.id);
        session = null; messages = []; paintMessages(); api.close();
      };
    },
  });
}

async function editPrompt() {
  const v = await promptDialog({
    title: "系统提示词", multiline: true,
    label: "告诉 Lume 它是谁、怎么回答",
    value: getSetting("systemPrompt", ""),
  });
  if (v === null) return;
  await setSetting("systemPrompt", v);
  toast("提示词已保存", "ok");
}

async function pickModel() {
  const cfg = aiConfig();
  const choice = await promptDialog({
    title: "模型名", label: "填写服务商提供的模型名", value: cfg.model || "",
  });
  if (!choice) return;
  await setSetting("apiModel", choice);
  const effort = await actionSheet([
    { label: "快速（low）", value: "low" }, { label: "标准（high）", value: "high" },
    { label: "深度（max）", value: "max" }, { label: "关闭思考", value: "off" },
  ], "思考强度");
  if (effort) await setSetting("apiEffort", effort);
  toast("已切换：" + choice, "ok");
  setHeader("Lume", "AI 助手 · " + choice, [
    { icon: "plus", title: "新对话", onClick: () => newChat() },
    { icon: "more-horizontal", title: "菜单", onClick: () => openMenu() },
  ]);
}

function openHistory() {
  openSheet({
    title: "历史会话",
    build(body, api) {
      body.innerHTML = sessions.length
        ? '<div class="list">' + sessions.map((s) =>
            '<div class="list-item" data-s="' + s.id + '"><div class="li-ico">' + icon("message") + "</div>" +
            '<div class="li-body"><div class="li-title">' + esc(s.title || "新对话") + "</div>" +
            '<div class="li-sub">' + (s.messages ? s.messages.filter((m) => m.role === "user").length : 0) + " 条提问 · " + fmtRelative(s.updatedAt) + "</div></div>" +
            '<button class="icon-btn plain" data-del="' + s.id + '" style="width:30px;height:30px">' + icon("trash") + "</button></div>").join("") + "</div>"
        : emptyState("message", "还没有历史会话", "开始一次对话就会自动保存。");
      body.querySelectorAll("[data-s]").forEach((n) => n.onclick = async (e) => {
        if (e.target.closest("[data-del]")) return;
        const s = sessions.find((x) => x.id === n.dataset.s);
        if (!s) return;
        session = s; messages = (s.messages || []).slice();
        messages.forEach((m) => { m.streaming = false; });
        paintMessages(); api.close();
      });
      body.querySelectorAll("[data-del]").forEach((n) => n.onclick = async (e) => {
        e.stopPropagation();
        const id = n.dataset.del;
        await db.del("chats", id);
        sessions = sessions.filter((x) => x.id !== id);
        if (session && session.id === id) { session = null; messages = []; paintMessages(); }
        api.close();
        openHistory();
      });
    },
  });
}
