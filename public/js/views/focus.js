/* 专注：番茄钟 + 记录 */
import { db, getSetting, setSetting } from "../db.js";
import { setHeader, navigate } from "../shell.js";
import { icon } from "../icons.js";
import { esc, toast, confirmDialog, promptDialog } from "../ui.js";
import { fmtRelative, dateStr, pad2 } from "../util.js";
import { requestNotifyPermission, beep } from "../reminders.js";

let rootEl = null;
let timer = null;
let running = false;
let totalSec = 25 * 60;
let leftSec = 25 * 60;
let label = "专注";
let wakeLock = null;
let startAt = 0;
let sessions = [];

export async function render(root) {
  rootEl = root;
  setHeader("专注", "给自己一段不被打扰的时间", []);
  sessions = (await db.all("focus")).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  if (!running) { leftSec = totalSec; }
  paint();
  startTicking();
  return () => { stopTicking(); releaseWakeLock(); };
}

function startTicking() {
  stopTicking();
  timer = setInterval(() => {
    if (!running) return;
    leftSec -= 1;
    if (leftSec <= 0) finish();
    paintRing();
  }, 1000);
}
function stopTicking() { if (timer) clearInterval(timer); timer = null; }

function paint() {
  const pct = totalSec ? (1 - leftSec / totalSec) : 0;
  const r = 104, c = 2 * Math.PI * r;
  const minutes = Math.floor(leftSec / 60), seconds = leftSec % 60;
  rootEl.innerHTML =
    '<div class="focus-screen">' +
      '<div class="focus-ring">' +
        '<svg viewBox="0 0 238 238"><circle class="ring-bg" cx="119" cy="119" r="' + r + '" />' +
        '<circle class="ring-fg" cx="119" cy="119" r="' + r + '" stroke-dasharray="' + c + '" stroke-dashoffset="' + (c * (1 - pct)) + '" /></svg>' +
        '<div class="focus-time"><span id="focus-time">' + pad2(minutes) + ":" + pad2(seconds) + '</span><small id="focus-label">' + esc(label) + "</small></div>" +
      "</div>" +
      '<div class="chips" id="focus-presets">' + [15, 25, 45, 60].map((m) =>
        '<button class="chip ' + (totalSec === m * 60 ? "active" : "") + '" data-min="' + m + '">' + m + " 分钟</button>").join("") +
      "</div>" +
      '<div class="btn-row" style="width:100%;max-width:320px">' +
        '<button class="btn primary" id="focus-toggle">' + (running ? icon("pause") + "暂停" : icon("play") + "开始") + "</button>" +
        '<button class="btn ghost" id="focus-reset" style="flex:0 0 auto;width:56px">' + icon("refresh") + "</button>" +
      "</div>" +
      '<div class="row" style="gap:8px"><button class="btn small ghost" id="focus-rename">' + icon("edit") + "改个名字</button>" +
        '<button class="btn small ghost" id="focus-notify">' + icon("bell") + "开启通知</button></div>" +
    "</div>" +
    '<div class="grid-2" style="margin-top:10px">' +
      '<div class="card tight"><div class="tiny muted">今天</div><div class="stat-num" id="stat-today">—</div></div>' +
      '<div class="card tight"><div class="tiny muted">连续专注</div><div class="stat-num" id="stat-count">' + sessions.filter((s) => s.day === dateStr()).length + "</div></div>" +
    "</div>" +
    '<div class="section-title"><span>最近记录</span><span class="spacer"></span><span class="tiny muted">' + sessions.length + " 次</span></div>" +
    '<div class="list">' + (sessions.length ? sessions.slice(0, 8).map((s) =>
      '<div class="list-item"><div class="li-ico">' + icon("timer") + '</div><div class="li-body"><div class="li-title">' + esc(s.label || "专注") +
      '</div><div class="li-sub">' + s.minutes + " 分钟 · " + esc(fmtRelative(s.startedAt)) + "</div></div>" +
      '<div class="li-trail">' + (s.completed ? icon("check") : '<span class="badge">未完成</span>') + "</div></div>").join("")
      : '<div class="list-item"><div class="li-body"><div class="li-sub">还没有专注记录</div></div></div>') + "</div>" +
    '<div class="hint" style="margin-top:12px">开始后保持页面在前台，切走时部分手机会暂停计时器。结束时会响一声并发送系统通知。</div>';

  rootEl.querySelectorAll("[data-min]").forEach((b) => b.onclick = () => {
    if (running) { toast("先暂停再改时长"); return; }
    totalSec = Number(b.dataset.min) * 60;
    leftSec = totalSec;
    rootEl.querySelectorAll("[data-min]").forEach((x) => x.classList.toggle("active", x === b));
    paint();
  });
  rootEl.querySelector("#focus-toggle").onclick = () => toggle();
  rootEl.querySelector("#focus-reset").onclick = () => { running = false; leftSec = totalSec; paint(); };
  rootEl.querySelector("#focus-rename").onclick = async () => {
    const v = await promptDialog({ title: "专注内容", label: "这段时间做什么？", value: label });
    if (v) { label = v; paint(); }
  };
  rootEl.querySelector("#focus-notify").onclick = async () => {
    const r = await requestNotifyPermission();
    toast(r === "granted" ? "已开启系统通知" : "未获授权", r === "granted" ? "ok" : "");
  };
  paintStats();
}

function paintRing() {
  const t = rootEl.querySelector("#focus-time");
  if (!t) return;
  t.textContent = pad2(Math.floor(leftSec / 60)) + ":" + pad2(leftSec % 60);
  const pct = totalSec ? (1 - leftSec / totalSec) : 0;
  const r = 104, c = 2 * Math.PI * r;
  const fg = rootEl.querySelector(".ring-fg");
  if (fg) fg.setAttribute("stroke-dashoffset", String(c * (1 - pct)));
}

async function paintStats() {
  const all = await db.all("focus");
  const today = dateStr();
  const minutes = all.filter((s) => s.day === today && s.completed).reduce((sum, s) => sum + s.minutes, 0);
  const node = rootEl.querySelector("#stat-today");
  if (node) node.textContent = minutes + " 分钟";
}

async function toggle() {
  if (running) {
    running = false;
    releaseWakeLock();
    paint();
    return;
  }
  if (leftSec <= 0) leftSec = totalSec;
  running = true;
  startAt = Date.now();
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
  } catch (e) {}
  paint();
}

async function finish() {
  running = false;
  releaseWakeLock();
  beep();
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("专注结束", { body: label + " · " + Math.round(totalSec / 60) + " 分钟已完成", icon: "icons/app-192.png" });
    }
  } catch (e) {}
  await db.put("focus", {
    id: "f" + Date.now().toString(36), minutes: Math.round(totalSec / 60),
    label, day: dateStr(), startedAt: startAt || Date.now(), completed: 1,
  });
  sessions = (await db.all("focus")).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  toast("专注完成，休息一下", "ok");
  leftSec = totalSec;
  paint();
}

async function releaseWakeLock() {
  try { if (wakeLock) { await wakeLock.release(); wakeLock = null; } } catch (e) {}
}
