/* 工作汇报：勾选日程 → 生成汇报 → 发邮件 */
import { db, getSetting, setSetting } from "../db.js";
import { setHeader, navigate } from "../shell.js";
import { icon } from "../icons.js";
import { esc, toast, emptyState, openSheet, confirmDialog, qs, el } from "../ui.js";
import {
  dateStr, addDays, startOfWeek, endOfWeek, fmtDateCN, weekdayCN, eventInstances,
  fmtTime, readFile, downloadText, uid, diffDays, isDoneOn,
} from "../util.js";
import { aiText } from "../ai.js";
import { openCompose } from "./mail.js";
import { bridge, checkBridge } from "../api.js";

let rootEl = null;
let state = null;

export async function render(root) {
  rootEl = root;
  const today = dateStr();
  state = state || {
    weekStart: startOfWeek(today),
    selected: new Set(),
    extra: "",
    text: "",
    files: [],
    aiDone: false,
  };
  setHeader("工作汇报", "把这一周做的事发出去", [
    { icon: "refresh", title: "换一周", onClick: () => { state.weekStart = startOfWeek(dateStr()); state.selected.clear(); state.text = ""; paint(); } },
  ]);
  paint();
  return () => {};
}

function range() {
  return { from: state.weekStart, to: endOfWeek(state.weekStart) };
}

async function paint() {
  const { from, to } = range();
  const events = await db.all("events");
  const instances = eventInstances(events, from, to);
  const done = instances.filter((e) => isDoneOn(e, e.instanceDate));
  const candidates = instances;
  const selectedCount = candidates.filter((e) => state.selected.has(e.id + "@" + e.instanceDate)).length;
  const subject = "工作汇报 · " + from.slice(5) + " ~ " + to.slice(5);

  rootEl.innerHTML =
    '<div class="card tint">' +
      '<div class="row"><span class="card-ico">' + icon("send") + '</span><span class="card-title">本周汇报</span>' +
      '<span class="spacer"></span><span class="tiny muted">' + esc(getSetting("userName", "") || "我") + "</span></div>" +
      '<div class="row" style="margin-top:10px;gap:8px">' +
        '<button class="icon-btn" id="wk-prev">' + icon("chevron-left") + "</button>" +
        '<div style="flex:1;text-align:center"><div class="bold">' + fmtDateCN(from) + " – " + fmtDateCN(to) + "</div>" +
        '<div class="tiny muted">' + (diffDays(from, to) + 1) + " 天 · " + instances.length + " 个日程 · 完成 " + done.length + "</div></div>" +
        '<button class="icon-btn" id="wk-next">' + icon("chevron-right") + "</button>" +
      "</div>" +
      '<div class="row" style="margin-top:10px;gap:8px"><button class="btn tiny ghost" id="sel-done">只选已完成的</button>' +
        '<button class="btn tiny ghost" id="sel-all">全选</button><button class="btn tiny ghost" id="sel-none">全不选</button></div>' +
    "</div>" +

    '<div class="section-title"><span>我完成了什么任务</span><span class="spacer"></span><span class="tiny muted">已选 ' + selectedCount + " 项</span></div>" +
    (candidates.length ? '<div class="card tight" style="padding:4px 14px">' + candidates.map((ev) => {
      const key = ev.id + "@" + ev.instanceDate;
      const on = state.selected.has(key);
      const done = isDoneOn(ev, ev.instanceDate);
      return '<div class="row" data-pick="' + esc(key) + '" style="padding:9px 0;border-bottom:1px solid var(--line);cursor:pointer;gap:10px">' +
        '<span class="check ' + (on ? "on" : "") + '" style="--c:var(--accent);width:24px;height:24px">' + icon("check") + "</span>" +
        '<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:' + (done ? 600 : 500) + '">' + esc(ev.title) + "</div>" +
        '<div class="tiny muted">' + esc(fmtDateCN(ev.instanceDate)) + " " + esc(fmtTime(ev.start)) + (done ? " · 已完成" : "") + "</div></div></div>";
    }).join("") + "</div>"
      : '<div class="card">' + emptyState("calendar", "这一周没有日程", "先到日历里安排几件事，再来生成汇报。") + "</div>") +

    '<div class="section-title"><span>我完成了什么结果</span></div>' +
    '<textarea class="textarea" id="rp-extra" placeholder="补充成果、数据、链接…（可空）" style="min-height:90px">' + esc(state.extra) + "</textarea>" +
    '<div class="row" style="gap:8px;margin-top:10px">' +
      '<button class="btn small ghost" id="rp-files">' + icon("paperclip") + "成果文件</button>" +
      '<span class="spacer"></span><button class="btn small soft" id="rp-ai">' + icon("sparkles") + "AI 润色</button>" +
    "</div>" +
    (state.files.length ? '<div class="attach-row">' + state.files.map((f, i) =>
      '<span class="attach-chip">' + icon("file") + esc(f.filename) + '<span class="x" data-rm="' + i + '">✕</span></span>').join("") + "</div>" : "") +

    '<div class="section-title"><span>汇报正文</span><span class="spacer"></span><button id="rp-gen">由勾选的日程生成</button></div>' +
    '<textarea class="textarea" id="rp-text" placeholder="点上面的「由勾选的日程生成」，或直接写…" style="min-height:200px">' + esc(state.text) + "</textarea>" +

    '<div class="grid-2" style="margin-top:12px">' +
      '<div class="field"><label>收件人</label><input class="input" id="rp-to" value="' + esc(getSetting("reportTo", "")) + '" placeholder="manager@example.com" /></div>' +
      '<div class="field"><label>主题</label><input class="input" id="rp-subject" value="' + esc(subject) + '" /></div>' +
    "</div>" +
    '<div class="btn-row" style="margin-top:14px">' +
      '<button class="btn ghost" id="rp-save">存草稿</button>' +
      '<button class="btn primary" id="rp-send">' + icon("send") + "写邮件并发送</button>" +
    "</div>" +
    '<div class="hint" style="margin-top:12px">发送需要 SMTP 配置与本地服务；草稿会留在「邮箱 → 发件箱」里。</div>' +
    '<div style="height:20px"></div>';

  bind();
}

function bind() {
  const $ = (id) => rootEl.querySelector("#" + id);
  $("wk-prev").onclick = () => { state.weekStart = addDays(state.weekStart, -7); state.selected.clear(); state.text = ""; paint(); };
  $("wk-next").onclick = () => { state.weekStart = addDays(state.weekStart, 7); state.selected.clear(); state.text = ""; paint(); };
  $("sel-all").onclick = () => { rootEl.querySelectorAll("[data-pick]").forEach((n) => state.selected.add(n.dataset.pick)); paint(); };
  $("sel-none").onclick = () => { state.selected.clear(); paint(); };
  $("sel-done").onclick = async () => {
    const { from, to } = range();
    const events = await db.all("events");
    state.selected.clear();
    eventInstances(events, from, to).filter((e) => isDoneOn(e, e.instanceDate)).forEach((e) => state.selected.add(e.id + "@" + e.instanceDate));
    paint();
  };
  rootEl.querySelectorAll("[data-pick]").forEach((n) => n.onclick = () => {
    const k = n.dataset.pick;
    if (state.selected.has(k)) state.selected.delete(k); else state.selected.add(k);
    paint();
  });
  $("rp-extra").addEventListener("input", (e) => state.extra = e.target.value);
  $("rp-text").addEventListener("input", (e) => state.text = e.target.value);
  $("rp-to").addEventListener("input", (e) => setSetting("reportTo", e.target.value.trim()));
  $("rp-files").onclick = async () => {
    const input = document.createElement("input");
    input.type = "file"; input.multiple = true;
    input.onchange = async () => {
      for (const f of Array.from(input.files || [])) {
        if (f.size > 10 * 1024 * 1024) { toast(f.name + " 太大", "err"); continue; }
        const dataUrl = await readFile(f, "dataurl");
        state.files.push({ filename: f.name, contentType: f.type || "application/octet-stream", size: f.size, contentBase64: String(dataUrl).split(",")[1] || "" });
      }
      paint();
    };
    input.click();
  };
  rootEl.querySelectorAll("[data-rm]").forEach((x) => x.onclick = () => { state.files.splice(Number(x.dataset.rm), 1); paint(); });
  $("rp-gen").onclick = async () => { state.text = await buildReport(); paint(); };
  $("rp-ai").onclick = async () => {
    if (!state.text) state.text = await buildReport();
    const base = state.text;
    if (!base.trim()) { toast("先勾选几项日程", "err"); return; }
    toast("正在润色…");
    try {
      const out = await aiText([
        { role: "system", content: "你是写作助手，帮用户把工作记录整理成简洁、专业的中文周报。不要编造没有的事实。" },
        { role: "user", content: getSetting("sceneWeekly", "把下面这一周的日程与完成情况整理成周报，分「本周完成」「遇到的问题」「下周计划」三段，总字数 400 字以内。") + "\n\n" + base },
      ], { maxTokens: 900 });
      state.text = out || base;
      state.aiDone = true;
      paint();
      toast("润色完成", "ok");
    } catch (e) { toast("AI 润色失败：" + (e.message || e), "err"); }
  };
  $("rp-save").onclick = async () => {
    if (!state.text) state.text = await buildReport();
    await saveDraft();
    toast("草稿已保存", "ok");
    navigate("mail");
  };
  $("rp-send").onclick = async () => {
    if (!state.text) state.text = await buildReport();
    const to = $("rp-to").value.trim();
    if (!to) { toast("先填收件人", "err"); return; }
    await setSetting("reportTo", to);
    openCompose({
      to, subject: $("rp-subject").value.trim() || "工作汇报",
      body: state.text, attachments: state.files,
    });
  };
}

async function buildReport() {
  const { from, to } = range();
  const events = await db.all("events");
  const list = eventInstances(events, from, to).filter((e) => state.selected.has(e.id + "@" + e.instanceDate));
  const byDay = new Map();
  for (const ev of list) {
    if (!byDay.has(ev.instanceDate)) byDay.set(ev.instanceDate, []);
    byDay.get(ev.instanceDate).push(ev);
  }
  const lines = ["本周完成", ""];
  if (!byDay.size) lines.push("（未勾选日程，可以手动补充）");
  for (const [day, evs] of Array.from(byDay.entries()).sort()) {
    lines.push(fmtDateCN(day) + " " + weekdayCN(day));
    for (const ev of evs) {
      lines.push("· " + ev.title + (ev.location ? "（" + ev.location + "）" : "") + (isDoneOn(ev, ev.instanceDate) ? " —— 已完成" : ""));
    }
    lines.push("");
  }
  if (state.extra.trim()) {
    lines.push("我完成的结果", "", state.extra.trim(), "");
  }
  lines.push("遇到的问题", "", "（如有可补充）", "", "下周计划", "", "（继续推进现有任务）");
  return lines.join("\n");
}

async function saveDraft() {
  const to = rootEl.querySelector("#rp-to").value.trim();
  const subject = rootEl.querySelector("#rp-subject").value.trim() || "工作汇报";
  await db.put("mails", {
    id: uid(), folder: "outbox", status: "draft", isReport: 1,
    accountId: "", to, cc: "", subject, text: state.text,
    attachments: state.files, createdAt: Date.now(), updatedAt: Date.now(),
  });
  window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "mails" } }));
}
