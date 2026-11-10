/* 日历：月视图 / 周视图 / 当天日程 */
import { db } from "../db.js";
import { setHeader } from "../shell.js";
import { icon } from "../icons.js";
import { esc, toast, emptyState, confirmDialog, onLongPress } from "../ui.js";
import {
  EVENT_COLORS, dateStr, addDays, addMonths, monthMatrix, fmtDateCN, weekdayCN,
  eventsOnDay, eventInstances, parseDate, fmtTime, timeToMin, weekDays,
  weekdayOfDate, remindLabel, repeatLabel, isDoneOn, withDoneOn,
} from "../util.js";
import { openEventEditor, openEventActions } from "../eventEditor.js";

const PERIODS = [
  [1, "08:00", "08:45"], [2, "08:55", "09:40"], [3, "09:55", "10:40"], [4, "10:50", "11:35"],
  [5, "11:45", "12:30"], [6, "13:30", "14:15"], [7, "14:25", "15:10"], [8, "15:25", "16:10"],
  [9, "16:20", "17:05"], [10, "17:15", "18:00"], [11, "18:30", "19:15"], [12, "19:25", "20:10"],
  [13, "20:20", "21:05"], [14, "21:15", "22:00"],
];

let state = null;
let rootEl = null;
let eventsCache = [];
let manageMode = false;
const picked = new Set();

export async function render(root) {
  rootEl = root;
  const today = dateStr();
  const d = parseDate(today);
  if (!state) {
    state = {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      selected: today,
      mode: localStorage.getItem("dl:cal-mode") || "month",
    };
  }
  setHeader("日历", "");
  const bar = document.getElementById("topbar");
  bar.querySelector(".topbar-actions").innerHTML =
    '<button class="btn small soft" id="cal-today">今天</button>' +
    '<button class="icon-btn" id="cal-manage" title="多选">' + icon("check") + "</button>" +
    '<button class="icon-btn" id="cal-mode" title="切换视图">' + icon(state.mode === "month" ? "list" : "calendar") + "</button>";
  bar.querySelector("#cal-today").onclick = () => {
    const n = parseDate(dateStr());
    state.year = n.getFullYear(); state.month = n.getMonth() + 1; state.selected = dateStr();
    draw();
  };
  bar.querySelector("#cal-mode").onclick = () => {
    state.mode = state.mode === "month" ? "week" : "month";
    localStorage.setItem("dl:cal-mode", state.mode);
    bar.querySelector("#cal-mode").innerHTML = icon(state.mode === "month" ? "list" : "calendar");
    draw();
  };
  const manageBtn = bar.querySelector("#cal-manage");
  manageBtn.classList.toggle("accent", manageMode);
  manageBtn.onclick = () => {
    manageMode = !manageMode;
    picked.clear();
    manageBtn.classList.toggle("accent", manageMode);
    draw();
  };
  eventsCache = await db.all("events");
  draw();
  const onData = async () => { eventsCache = await db.all("events"); draw(); };
  window.addEventListener("danlume:data", onData);
  return () => {
    window.removeEventListener("danlume:data", onData);
    manageMode = false;
    picked.clear();
  };
}

function draw() {
  if (!rootEl) return;
  const { year, month, selected } = state;
  const nm = addMonths(year, month, 1);
  const first = year + "-" + String(month).padStart(2, "0") + "-01";
  const last = addDays(nm.year + "-" + String(nm.month).padStart(2, "0") + "-01", -1);
  const monthInstances = eventInstances(eventsCache, first, last);
  const doneCount = monthInstances.filter((e) => isDoneOn(e, e.instanceDate)).length;
  const head = '<div class="cal-head"><div><div class="cal-month">' + year + " 年 " + month + " 月</div>" +
    '<div class="cal-sub">本月 ' + monthInstances.length + " 个日程 · 已完成 " + doneCount + " 个</div></div>" +
    '<span class="spacer"></span><div class="cal-nav">' +
      '<button class="icon-btn" data-nav="-1" aria-label="上一页">' + icon("chevron-left") + "</button>" +
      '<button class="icon-btn" data-nav="1" aria-label="下一页">' + icon("chevron-right") + "</button>" +
    "</div></div>";
  const body = state.mode === "month" ? monthView(monthInstances) : weekView();
  const bulk = manageMode
    ? '<div class="bulk-bar"><span class="bulk-count">已选 ' + picked.size + ' 项</span>' +
      '<button class="btn tiny ghost" id="cal-all">全选</button>' +
      '<button class="btn tiny soft" id="cal-done">完成</button>' +
      '<button class="btn tiny danger" id="cal-del">删除</button>' +
      '<span class="spacer"></span><button class="btn tiny ghost" id="cal-exit">退出</button></div>'
    : "";
  rootEl.innerHTML = head + body + dayAgenda(selected) + '<div style="height:' + (manageMode ? "96px" : "24px") + '"></div>' + bulk;

  rootEl.querySelectorAll("[data-nav]").forEach((b) => {
    b.onclick = () => {
      const delta = Number(b.dataset.nav);
      if (state.mode === "month") {
        const n = addMonths(state.year, state.month, delta);
        state.year = n.year; state.month = n.month;
      } else {
        const nd = addDays(state.selected, delta * 7);
        const d = parseDate(nd);
        state.selected = nd; state.year = d.getFullYear(); state.month = d.getMonth() + 1;
      }
      picked.clear();
      draw();
    };
  });
  rootEl.querySelectorAll("[data-day]").forEach((cell) => {
    cell.onclick = () => {
      const day = cell.dataset.day;
      state.selected = day;
      const d = parseDate(day);
      state.year = d.getFullYear(); state.month = d.getMonth() + 1;
      picked.clear();
      draw();
    };
  });
  rootEl.querySelectorAll("[data-ev]").forEach((n) => {
    n.onclick = async (e) => {
      if (e.target.closest("[data-check]") || e.target.closest("[data-pick]")) return;
      if (manageMode) {
        const id = n.dataset.ev;
        if (picked.has(id)) picked.delete(id); else picked.add(id);
        draw();
        return;
      }
      const ev = await db.get("events", n.dataset.ev);
      if (!ev) return;
      openEventEditor({ event: { ...ev, instanceDate: n.dataset.date } });
    };
  });
  rootEl.querySelectorAll("[data-ev]").forEach((n) => {
    onLongPress(n, async () => {
      if (manageMode) return;
      const ev = await db.get("events", n.dataset.ev);
      if (ev) openEventActions(ev, n.dataset.date);
    });
  });
  rootEl.querySelectorAll("[data-pick]").forEach((n) => {
    n.onclick = (e) => {
      e.stopPropagation();
      const id = n.dataset.pick;
      if (picked.has(id)) picked.delete(id); else picked.add(id);
      draw();
    };
  });
  rootEl.querySelectorAll("[data-check]").forEach((n) => {
    n.onclick = async (e) => {
      e.stopPropagation();
      const ev = await db.get("events", n.dataset.check);
      if (!ev) return;
      const day = n.dataset.checkDate || state.selected;
      const done = isDoneOn(ev, day);
      await db.put("events", withDoneOn(ev, day, !done));
      toast(done ? "已恢复" : "完成了");
      eventsCache = await db.all("events");
      draw();
    };
  });
  rootEl.querySelectorAll("[data-newday]").forEach((b) => {
    b.onclick = () => openEventEditor({ date: state.selected });
  });
  const weekDoneBtn = rootEl.querySelector("#wk-done");
  if (weekDoneBtn) weekDoneBtn.onclick = async () => {
    const days = weekDays(state.selected);
    const list = eventInstances(eventsCache, days[0], days[6]).filter((e) => e.source === "fudan");
    if (!list.length) { toast("本周没有同步的课程"); return; }
    for (const item of list) {
      const ev = await db.get("events", item.id);
      if (ev) await db.put("events", withDoneOn(ev, item.instanceDate, true));
    }
    toast("已完成本周 " + list.length + " 节课程", "ok");
    eventsCache = await db.all("events");
    draw();
  };
  const allBtn = rootEl.querySelector("#cal-all");
  if (allBtn) allBtn.onclick = () => {
    const evs = eventsOnDay(eventsCache, state.selected);
    if (picked.size === evs.length) picked.clear();
    else evs.forEach((ev) => picked.add(ev.id));
    draw();
  };
  const doneBtn = rootEl.querySelector("#cal-done");
  if (doneBtn) doneBtn.onclick = async () => {
    if (!picked.size) { toast("先选择日程"); return; }
    for (const id of picked) {
      const ev = await db.get("events", id);
      if (ev) await db.put("events", withDoneOn(ev, state.selected, true));
    }
    toast("已完成 " + picked.size + " 项", "ok");
    picked.clear();
    eventsCache = await db.all("events");
    draw();
  };
  const delBtn = rootEl.querySelector("#cal-del");
  if (delBtn) delBtn.onclick = async () => {
    if (!picked.size) { toast("先选择日程"); return; }
    const ok = await confirmDialog({
      title: "批量删除",
      message: "将删除选中的 " + picked.size + " 条日程" + (picked.size > 1 ? "；重复日程会删除整个系列" : "") + "，无法恢复。",
      ok: "删除", danger: true,
    });
    if (!ok) return;
    for (const id of picked) await db.del("events", id);
    toast("已删除 " + picked.size + " 条", "ok");
    picked.clear();
    eventsCache = await db.all("events");
    draw();
  };
  const exitBtn = rootEl.querySelector("#cal-exit");
  if (exitBtn) exitBtn.onclick = () => { manageMode = false; picked.clear(); draw(); };
  bindSwipe();
}

function monthView(instances) {
  const cells = monthMatrix(state.year, state.month);
  const byDay = new Map();
  for (const ev of instances) {
    if (!byDay.has(ev.instanceDate)) byDay.set(ev.instanceDate, []);
    byDay.get(ev.instanceDate).push(ev);
  }
  const today = dateStr();
  let html = '<div class="cal-grid">' +
    ["一", "二", "三", "四", "五", "六", "日"].map((w) => '<div class="cal-dow">' + w + "</div>").join("");
  for (const cell of cells) {
    const list = byDay.get(cell.date) || [];
    const cls = ["cal-cell"];
    if (!cell.inMonth) cls.push("out");
    if (cell.date === today) cls.push("today");
    if (cell.date === state.selected) cls.push("selected");
    const dots = list.slice(0, 3).map((e) =>
      '<span style="background:' + ((EVENT_COLORS[e.color] || {}).value || "#2F7A5F") + '"></span>').join("");
    html += '<div class="' + cls.join(" ") + '" data-day="' + cell.date + '">' +
      "<span>" + cell.day + "</span>" +
      '<div class="cal-dots">' + dots + "</div>" +
      (list.length > 3 ? '<span class="cal-more">+' + (list.length - 3) + "</span>" : "") +
      "</div>";
  }
  html += "</div>";
  return '<div class="card tight" style="padding:8px 6px 10px">' + html + "</div>" +
    '<div class="swipe-hint">左右滑动切换月份 · 点日期查看当天</div>';
}

function weekView() {
  const days = weekDays(state.selected);
  const today = dateStr();
  const all = eventInstances(eventsCache, days[0], days[6]);
  const byDay = new Map();
  for (const ev of all) {
    if (!byDay.has(ev.instanceDate)) byDay.set(ev.instanceDate, []);
    byDay.get(ev.instanceDate).push(ev);
  }
  let html = '<div class="cal-week"><div class="wk-corner"></div>' +
    days.map((d) => '<div class="wk-day" data-day="' + d + '" style="cursor:pointer">' +
      ["一", "二", "三", "四", "五", "六", "日"][weekdayOfDate(d)] +
      '<b style="' + (d === today ? "color:var(--accent)" : "") + '">' + parseDate(d).getDate() + "</b></div>").join("");
  PERIODS.forEach((p, i) => {
    const [num, start] = p;
    const nextStart = i < PERIODS.length - 1 ? PERIODS[i + 1][1] : "24:00";
    html += '<div class="wk-period"><span>' + num + "</span><span style='font-size:8px;opacity:.7'>" + start + "</span></div>";
    for (const d of days) {
      const list = (byDay.get(d) || []).filter((ev) => {
        const m = timeToMin(ev.start || "09:00");
        return m >= timeToMin(start) && m < timeToMin(nextStart);
      });
      const ev = list[0];
      if (ev) {
        const color = (EVENT_COLORS[ev.color] || {}).value || "#2F7A5F";
        html += '<div class="wk-cell has" data-ev="' + esc(ev.id) + '" data-date="' + d + '" style="cursor:pointer">' +
          '<div class="wk-block" style="background:' + color + '"><b>' + esc(ev.title.slice(0, 6)) + "</b>" +
          esc(fmtTime(ev.start)) + "</div></div>";
      } else {
        html += '<div class="wk-cell" data-day="' + d + '"></div>';
      }
    }
  });
  html += "</div>";
  const weekCourses = eventInstances(eventsCache, days[0], days[6]).filter((e) => e.source === "fudan");
  const weekDone = weekCourses.filter((e) => isDoneOn(e, e.instanceDate)).length;
  return '<div class="card tight" style="padding:10px 6px">' + html + "</div>" +
    '<div class="row" style="margin-top:10px;gap:8px"><span class="tiny muted">本周课程 ' + weekCourses.length + " 节 · 已完成 " + weekDone + "</span>" +
    '<span class="spacer"></span><button class="btn small soft" id="wk-done">本周课程全部完成</button></div>' +
    '<div class="swipe-hint">左右滑动切换周 · 点日期查看当天</div>';
}

function dayAgenda(day) {
  const list = eventsOnDay(eventsCache, day);
  const today = dateStr();
  const rel = day === today ? "今天" : weekdayCN(day);
  let html = '<div class="section-title"><span>' + fmtDateCN(day, true) + " · " + rel + " · " + list.length + " 个日程</span>" +
    '<span class="spacer"></span><button data-newday="1">新建</button></div>';
  if (!list.length) {
    html += '<div class="card">' + emptyState("calendar", "这一天还是空的", "点上方「新建」添加一条日程。") + "</div>";
  } else {
    html += '<div class="stack">' + list.map((ev) => {
      const color = (EVENT_COLORS[ev.color] || {}).value || "#2F7A5F";
      const isPicked = manageMode && picked.has(ev.id);
      const done = isDoneOn(ev, day);
      return '<div class="ev-card ' + (isPicked ? "selected" : "") + '" style="--c:' + color + '" data-ev="' + esc(ev.id) + '" data-date="' + day + '">' +
        '<div class="ev-top">' +
          (manageMode ? '<button class="check ' + (isPicked ? "on" : "") + '" data-pick="' + esc(ev.id) + '" style="--c:' + color + '" aria-label="选择">' + icon("check") + "</button>" : "") +
          '<span class="badge" style="background:color-mix(in srgb, ' + color + ' 16%, transparent);color:' + color + '">' +
          esc(fmtTime(ev.start)) + (ev.end ? " – " + esc(fmtTime(ev.end)) : "") + "</span>" +
          (ev.repeat ? '<span class="badge">' + repeatLabel(ev.repeat) + "</span>" : "") +
          '<span class="spacer"></span>' +
          (manageMode ? "" : '<button class="check ' + (done ? "on" : "") + '" data-check="' + esc(ev.id) + '" data-check-date="' + esc(day) + '" style="--c:' + color + '" aria-label="完成">' + icon("check") + "</button>") +
        "</div>" +
        '<div class="ev-title ' + (done ? "ev-done" : "") + '">' + esc(ev.title) + "</div>" +
        (ev.description ? '<div class="ev-meta">' + esc(ev.description) + "</div>" : "") +
        '<div class="ev-meta">' +
          (ev.location ? "<span>" + icon("map-pin") + " " + esc(ev.location) + "</span>" : "") +
          (ev.remind != null ? "<span>" + icon("bell") + " " + esc(remindLabel(ev.remind)) + "</span>" : "") +
        "</div></div>";
    }).join("") + "</div>";
  }
  return html;
}

function bindSwipe() {
  const card = rootEl.querySelector(".card.tight");
  if (!card) return;
  let sx = 0, sy = 0;
  card.addEventListener("touchstart", (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
  card.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (state.mode === "month") {
      const n = addMonths(state.year, state.month, dx < 0 ? 1 : -1);
      state.year = n.year; state.month = n.month;
    } else {
      const nd = addDays(state.selected, dx < 0 ? 7 : -7);
      const d = parseDate(nd);
      state.selected = nd; state.year = d.getFullYear(); state.month = d.getMonth() + 1;
    }
    draw();
  }, { passive: true });
}