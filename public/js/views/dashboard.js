/* 仪表板 */
import { db, getSetting, setSetting } from "../db.js";
import { setHeader, navigate, refreshCurrent } from "../shell.js";
import { icon } from "../icons.js";
import { esc, emptyState, openSheet, toast, confirmDialog, onLongPress } from "../ui.js";
import { bridgeFetch } from "../api.js";
import {
  dateStr, addDays, fmtDateCN, weekdayCN, greeting, isoWeekNo, eventsOnDay,
  eventInstances, parseDate, fmtTime, diffDays, isDoneOn, withDoneOn,
} from "../util.js";
import { openEventEditor, openEventActions } from "../eventEditor.js";
import { fetchWeather, weatherInfo } from "../weather.js";
import { applyTheme, isDark } from "../ui.js";

const COLORS = { violet: "#AF52DE", teal: "#30B0C7", amber: "#FF9500", rose: "#FF2D55", sky: "#007AFF" };
const REPEAT_TEXT = { daily: "每天", weekly: "每周", monthly: "每月", yearly: "每年" };

let activeRoot = null;
let manageMode = false;
const selection = new Set();

function repaint() { if (activeRoot) render(activeRoot); }
window.addEventListener("danlume:data", () => {
  if (activeRoot && location.hash.startsWith("#/dashboard")) repaint();
});

function teachingWeek(today) {
  const term = getSetting("termStart", "");
  if (term && /^\d{4}-\d{2}-\d{2}$/.test(term)) {
    const w = Math.floor(diffDays(term, today) / 7) + 1;
    if (w >= 1 && w <= Number(getSetting("totalWeeks", "18")) + 6) return "第 " + w + " 教学周";
  }
  return "第 " + isoWeekNo(today) + " 周";
}

function eventRow(ev) {
  const color = COLORS[ev.color] || "#2F7A5F";
  const picked = manageMode && selection.has(ev.id);
  const done = isDoneOn(ev, ev.instanceDate || ev.date);
  const check = manageMode
    ? '<button class="check ' + (picked ? "on" : "") + '" data-pick="' + esc(ev.id) + '" aria-label="选择">' + icon("check") + "</button>"
    : '<button class="check ' + (done ? "on" : "") + '" data-done="' + esc(ev.id) + '" data-date="' + esc(ev.instanceDate || ev.date) + '" aria-label="完成">' + icon("check") + "</button>";
  return '<div class="agenda-row ' + (picked ? "selected" : "") + '" data-event="' + esc(ev.id) + '" data-date="' + esc(ev.instanceDate || ev.date) + '">' +
    '<div class="agenda-time">' + esc(fmtTime(ev.start)) + (ev.end ? "<br>" + esc(fmtTime(ev.end)) : "") + "</div>" +
    '<div class="agenda-body" style="--c:' + color + '">' +
      '<div class="agenda-title ' + (done ? "ev-done" : "") + '">' + esc(ev.title) + "</div>" +
      '<div class="agenda-meta">' +
        (ev.location ? "<span>" + icon("map-pin") + esc(ev.location) + "</span>" : "") +
        (ev.repeat ? '<span class="badge accent">' + (REPEAT_TEXT[ev.repeat] || "") + "</span>" : "") +
        (ev.remind != null ? "<span>" + icon("bell") + "提前 " + ev.remind + " 分</span>" : "") +
      "</div>" +
    "</div>" + check +
  "</div>";
}

function upcomingRow(ev) {
  const d = ev.instanceDate;
  const isTomorrow = d === addDays(dateStr(), 1);
  const color = COLORS[ev.color] || "#2F7A5F";
  return '<div class="list-item" data-event="' + esc(ev.id) + '" data-date="' + esc(d) + '">' +
    '<div class="li-ico" style="background:color-mix(in srgb, ' + color + ' 14%, transparent);color:' + color + '">' + icon("clock") + "</div>" +
    '<div class="li-body"><div class="li-title">' + esc(ev.title) + "</div>" +
      '<div class="li-sub">' + (isTomorrow ? "明天" : fmtDateCN(d)) + " · " + fmtTime(ev.start) + (ev.location ? " · " + esc(ev.location) : "") + "</div></div>" +
    '<div class="li-trail">' + icon("chevron-right") + "</div></div>";
}

function quick(ic, label, act, kind) {
  return '<button class="quick-item ' + (kind || "") + '" data-act="' + act + '">' +
    '<span class="qi-ico">' + icon(ic) + '</span><span>' + label + "</span></button>";
}
function campusCard(ic, title, value, go, key) {
  return '<div class="mini-card" ' + (key ? 'data-card-key="' + key + '"' : 'data-go="' + go + '"') + ' style="cursor:pointer">' +
    '<div class="row" style="gap:6px"><span class="card-ico" style="width:22px;height:22px">' + icon(ic) + "</span>" +
    '<span class="mini-k">' + title + "</span></div>" +
    '<div class="mini-v" id="campus-' + (key || title) + '">' + esc(value) + "</div></div>";
}

export async function render(root) {
  const today = dateStr();
  activeRoot = root;
  const weekLabel = teachingWeek(today);
  setHeader("DanLume", fmtDateCN(today, true) + " · " + weekdayCN(today), [
    { icon: isDark() ? "sun" : "moon", title: "切换主题", onClick: async () => {
        await setSetting("theme", isDark() ? "light" : "dark");
        applyTheme();
        refreshCurrent();
      } },
    { icon: "settings", title: "设置", onClick: () => navigate("settings") },
  ]);

  const [events, notices, homework, memos] = await Promise.all([
    db.all("events"), db.all("notices"), db.all("homework"), db.all("memos"),
  ]);
  const todayEvents = eventsOnDay(events, today);
  const doneToday = todayEvents.filter((e) => isDoneOn(e, e.instanceDate)).length;
  const unreadNotices = notices.filter((n) => !n.read);
  const pendingHw = homework.filter((h) => h.status !== "done");
  const dueSoonHw = pendingHw.filter((h) => h.due && h.due <= addDays(today, 3)).sort((a, b) => a.due.localeCompare(b.due));
  const upcoming = eventInstances(events, addDays(today, 1), addDays(today, 4)).slice(0, 6);
  const dow = (parseDate(today).getDay() + 6) % 7;
  const weekEvents = eventInstances(events, addDays(today, -dow), addDays(today, 6 - dow));
  const weekDone = weekEvents.filter((e) => isDoneOn(e, e.instanceDate)).length;
  const weekPct = weekEvents.length ? Math.round(weekDone / weekEvents.length * 100) : 0;

  root.innerHTML =
    '<div class="hero">' +
      '<div class="card date-card">' +
        '<div class="row"><span class="badge accent">今天</span><span class="spacer"></span><span class="week-chip">' + esc(weekLabel) + "</span></div>" +
        '<div style="margin-top:6px"><div class="big-day">' + parseDate(today).getDate() + "</div>" +
          '<div class="small bold" style="margin-top:4px">' + (parseDate(today).getMonth() + 1) + " 月 · " + weekdayCN(today) + "</div></div>" +
        '<div class="tiny muted" style="margin-top:8px">' + greeting() + " · 今天 " + todayEvents.length + " 个日程" + (doneToday ? " · 已完成 " + doneToday : "") + "</div>" +
      "</div>" +
      '<div class="card weather-card" id="weather-card">' + weatherSkeleton() + "</div>" +
    "</div>" +

    '<div class="quick-grid">' +
      quick("plus", "新建日程", "ev", "primary") +
      quick("note", "写备忘", "memo") +
      quick("sparkles", "问 Lume", "ai") +
      quick("send", "工作汇报", "report") +
    "</div>" +

    '<div class="card" style="margin-top:12px">' +
      '<div class="card-head"><span class="card-ico">' + icon("calendar") + "</span>" +
        '<span class="card-title">今天的日程</span><span class="spacer"></span>' +
        '<button class="btn tiny ghost" id="dash-manage">' + (manageMode ? "退出" : "管理") + "</button>" +
        '<button class="btn tiny soft" data-go="calendar">全部</button>' +
        '<button class="btn tiny primary" data-new="1">' + icon("plus") + "新建</button>" +
      "</div>" +
      (todayEvents.length ? todayEvents.map((e) => eventRow(e)).join("") :
        emptyState("calendar", "今天还没有安排", "新建一条日程，或者让 Lume 帮你安排。")) +
    "</div>" +

    '<div class="grid-2" style="margin-top:12px">' +
      '<div class="card tight" data-go="notices" style="cursor:pointer">' +
        '<div class="card-head" style="margin-bottom:6px"><span class="card-ico">' + icon("bell") + '</span><span class="card-title">教务通知</span></div>' +
        '<div class="stat-num">' + unreadNotices.length + '<span class="small muted" style="font-weight:500"> 条未读</span></div>' +
        '<div class="tiny muted ellipsis" style="margin-top:6px">' + esc(unreadNotices[0] ? unreadNotices[0].title : "还没有抓取通知") + "</div>" +
      "</div>" +
      '<div class="card tight" data-go="homework" style="cursor:pointer">' +
        '<div class="card-head" style="margin-bottom:6px"><span class="card-ico">' + icon("book") + '</span><span class="card-title">作业</span></div>' +
        '<div class="stat-num">' + pendingHw.length + '<span class="small muted" style="font-weight:500"> 项待完成</span></div>' +
        '<div class="tiny muted ellipsis" style="margin-top:6px">' + esc(dueSoonHw[0] ? dueSoonHw[0].course + " · " + dueSoonHw[0].title : "近期没有截止") + "</div>" +
      "</div>" +
    "</div>" +

    '<div class="section-title"><span>即将到来</span><span class="spacer"></span><button data-go="calendar">日历 ›</button></div>' +
    '<div class="list">' +
      (upcoming.length ? upcoming.map((ev) => upcomingRow(ev)).join("") :
        '<div class="list-item"><div class="li-body"><div class="li-sub">未来 3 天没有安排</div></div></div>') +
    "</div>" +

    '<div class="section-title"><span>本周进度</span><span class="spacer"></span><span class="tiny muted">' + weekDone + " / " + weekEvents.length + " 已完成</span></div>" +
    '<div class="card tight">' +
      '<div class="row" style="margin-bottom:8px"><span class="small bold">' + weekPct + '%</span>' +
        '<span class="spacer"></span><span class="tiny muted">' + esc(weekLabel) + "</span></div>" +
      '<div class="progress"><i style="width:' + weekPct + '%"></i></div>' +
      '<div class="row" style="margin-top:12px;gap:16px">' +
        '<div><div class="stat-num">' + weekEvents.length + '</div><div class="tiny muted">本周日程</div></div>' +
        '<div><div class="stat-num">' + weekDone + '</div><div class="tiny muted">本周完成</div></div>' +
        '<div><div class="stat-num">' + memos.length + '</div><div class="tiny muted">备忘</div></div>' +
        '<span class="spacer"></span>' +
        '<button class="btn small ghost" data-go="focus">' + icon("timer") + "专注</button>" +
      "</div>" +
    "</div>" +

    '<div class="section-title"><span>校园服务</span><span class="spacer"></span><button data-go="ehall">eHall ›</button></div>' +
    '<div class="hscroll">' +
      campusCard("card", "校园卡余额", campusValue("balance"), "ehall", "balance") +
      campusCard("bus", "校车安排", campusValue("bus"), "ehall", "bus") +
      campusCard("dumbbell", "体育刷锻", campusValue("sport"), "ehall", "sport") +
      campusCard("book-open", "图书馆人数", campusValue("library"), "ehall", "library") +
      campusCard("school", "空教室", "查空闲教室", "classroom") +
    "</div>" +
    '<div style="height:' + (manageMode ? "92px" : "10px") + '"></div>' +
    (manageMode ? '<div class="bulk-bar"><span class="bulk-count">已选 ' + selection.size + ' 项</span>' +
      '<button class="btn tiny ghost" id="dash-all">全选</button>' +
      '<button class="btn tiny soft" id="dash-done">完成</button>' +
      '<button class="btn tiny danger" id="dash-del">删除</button>' +
      '<span class="spacer"></span><button class="btn tiny ghost" id="dash-exit">退出</button></div>' : "");

  bind(root);
  loadWeather(root);
  loadCampusCards(root);
  return () => { activeRoot = null; manageMode = false; selection.clear(); };
}

function weatherSkeleton() {
  return '<div class="row"><span class="card-ico">' + icon("cloud") + '</span><span class="card-title small">天气</span>' +
    '<span class="spacer"></span><span class="tiny faint">' + esc(getSetting("weatherCity", "上海")) + "</span></div>" +
    '<div style="margin-top:10px"><div class="skeleton" style="height:34px;width:80px"></div>' +
    '<div class="skeleton" style="height:11px;width:120px;margin-top:8px"></div></div>';
}

async function loadWeather(root) {
  const node = root.querySelector("#weather-card");
  if (!node) return;
  try {
    const lat = getSetting("weatherLat", "31.2304");
    const lon = getSetting("weatherLon", "121.4737");
    const w = await fetchWeather(lat, lon);
    const info = weatherInfo(w.code);
    const todayW = w.daily[0];
    node.innerHTML =
      '<div class="row"><span class="card-ico">' + icon("cloud") + '</span><span class="card-title small">天气</span>' +
      '<span class="spacer"></span><span class="tiny faint">' + esc(getSetting("weatherCity", "上海")) + "</span></div>" +
      '<div class="row" style="margin-top:8px;gap:8px"><span class="weather-ico">' + info[1] + "</span>" +
        '<span class="weather-temp">' + w.temp + "°</span></div>" +
      '<div class="weather-desc">' + info[0] + " · 体感 " + w.feels + "°</div>" +
      '<div class="tiny muted" style="margin-top:4px">湿度 ' + w.humidity + "% · 风 " + w.wind + " km/h</div>" +
      (todayW ? '<div class="tiny muted" style="margin-top:2px">' + todayW.min + "° ~ " + todayW.max + "°</div>" : "");
    node.style.cursor = "pointer";
    node.onclick = () => navigate("settings", { card: "weather" });
  } catch (e) {
    node.innerHTML =
      '<div class="row"><span class="card-ico">' + icon("cloud") + '</span><span class="card-title small">天气</span><span class="spacer"></span></div>' +
      '<div class="small muted" style="margin-top:12px">暂时取不到天气</div>' +
      '<button class="btn tiny ghost" style="margin-top:8px" id="retry-weather">重试</button>';
    const btn = node.querySelector("#retry-weather");
    if (btn) btn.onclick = (e) => { e.stopPropagation(); loadWeather(root); };
  }
}

function campusUrl(key) {
  return getSetting("ehallCard_" + key, "") || "";
}
function campusValue(key) {
  try {
    const cache = JSON.parse(localStorage.getItem("danlume:campus") || "{}");
    if (cache[key] && cache[key].value) return cache[key].value;
  } catch (e) {}
  return campusUrl(key) ? "未同步" : "未填写地址";
}
async function loadCampusCards(root) {
  const keys = ["balance", "bus", "sport", "library"];
  const urls = keys.filter((k) => campusUrl(k));
  if (!urls.length) return;
  const cache = JSON.parse(localStorage.getItem("danlume:campus") || "{}");
  for (const key of urls) {
    try {
      const data = await bridgeFetch("/api/web/fetch", { url: campusUrl(key), limit: 600 }, { timeout: 15000 });
      const text = (data.text || "").replace(/\s+/g, " ").trim();
      const value = text ? text.slice(0, 16) : "没取到数据";
      cache[key] = { value, text: text.slice(0, 1200), at: Date.now() };
      const node = root.querySelector("#campus-" + key);
      if (node) node.textContent = value;
    } catch (e) {
      cache[key] = { value: "同步失败", text: String(e.message || e), at: Date.now() };
      const node = root.querySelector("#campus-" + key);
      if (node) node.textContent = "同步失败";
    }
  }
  localStorage.setItem("danlume:campus", JSON.stringify(cache));
}

function bind(root) {
  root.querySelectorAll("[data-card-key]").forEach((n) => {
    n.addEventListener("click", async () => {
      const key = n.dataset.cardKey;
      const url = campusUrl(key);
      if (!url) {
        toast("先在「设置 → 教务与 eHall」里填这张卡的数据来源地址");
        navigate("settings", { card: "campus" });
        return;
      }
      const cache = JSON.parse(localStorage.getItem("danlume:campus") || "{}");
      const item = cache[key];
      openSheet({
        title: "校园服务数据",
        build(body) {
          body.innerHTML = '<div class="small muted">' + esc(url) + "</div>" +
            '<div class="card flat tight small" style="margin-top:8px;white-space:pre-wrap">' + esc(item && item.text || "还没有同步过") + "</div>" +
            '<button class="btn small ghost" id="campus-refresh">重新同步</button>';
          body.querySelector("#campus-refresh").onclick = async () => {
            try {
              const data = await bridgeFetch("/api/web/fetch", { url, limit: 600 }, { timeout: 15000 });
              const text = (data.text || "").replace(/\s+/g, " ").trim();
              cache[key] = { value: text.slice(0, 16) || "没取到数据", text: text.slice(0, 1200), at: Date.now() };
              localStorage.setItem("danlume:campus", JSON.stringify(cache));
              toast("已同步", "ok");
              navigate("dashboard");
            } catch (e) { toast(e.message || "同步失败", "err"); }
          };
        },
      });
    });
  });
  root.querySelectorAll("[data-go]").forEach((n) => {
    n.addEventListener("click", (e) => {
      if (e.target.closest("[data-event]")) return;
      navigate(n.dataset.go);
    });
  });
  root.querySelectorAll("[data-new]").forEach((n) => n.addEventListener("click", () => openEventEditor({ date: dateStr() })));
  root.querySelectorAll("[data-act]").forEach((n) => {
    n.addEventListener("click", () => {
      const a = n.dataset.act;
      if (a === "ev") openEventEditor({ date: dateStr() });
      else if (a === "memo") navigate("memos", { new: "1" });
      else if (a === "ai") navigate("ai");
      else if (a === "report") navigate("report");
    });
  });
  function togglePick(id) {
    if (selection.has(id)) selection.delete(id); else selection.add(id);
    repaint();
  }
  root.querySelectorAll("[data-event]").forEach((n) => {
    n.addEventListener("click", async (e) => {
      if (e.target.closest("[data-done]")) return;
      const id = n.dataset.event;
      if (manageMode) { togglePick(id); return; }
      if (e.target.closest("[data-pick]")) return;
      const date = n.dataset.date;
      const ev = await db.get("events", id);
      if (!ev) return;
      openEventEditor({ event: { ...ev, instanceDate: date } });
    });
  });
  root.querySelectorAll("[data-event]").forEach((n) => {
    onLongPress(n, async () => {
      if (manageMode) return;
      const ev = await db.get("events", n.dataset.event);
      if (ev) openEventActions(ev, n.dataset.date);
    });
  });
  root.querySelectorAll("[data-pick]").forEach((n) => {
    n.addEventListener("click", (e) => { e.stopPropagation(); togglePick(n.dataset.pick); });
  });
  root.querySelectorAll("[data-done]").forEach((n) => {
    n.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = n.dataset.done;
      const day = n.dataset.date;
      const ev = await db.get("events", id);
      if (!ev) return;
      const next = withDoneOn(ev, day, !isDoneOn(ev, day));
      await db.put("events", next);
      window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "events" } }));
    });
  });
  const manageBtn = root.querySelector("#dash-manage");
  if (manageBtn) manageBtn.onclick = () => { manageMode = !manageMode; selection.clear(); repaint(); };
  const exitBtn = root.querySelector("#dash-exit");
  if (exitBtn) exitBtn.onclick = () => { manageMode = false; selection.clear(); repaint(); };
  const allBtn = root.querySelector("#dash-all");
  if (allBtn) allBtn.onclick = async () => {
    const evs = eventsOnDay(await db.all("events"), dateStr());
    if (selection.size === evs.length) selection.clear();
    else evs.forEach((ev) => selection.add(ev.id));
    repaint();
  };
  const doneBtn = root.querySelector("#dash-done");
  if (doneBtn) doneBtn.onclick = async () => {
    if (!selection.size) { toast("先选择日程"); return; }
    const day = dateStr();
    for (const id of selection) {
      const ev = await db.get("events", id);
      if (ev) await db.put("events", withDoneOn(ev, day, true));
    }
    toast("已完成 " + selection.size + " 项", "ok");
    selection.clear();
    window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "events" } }));
  };
  const delBtn = root.querySelector("#dash-del");
  if (delBtn) delBtn.onclick = async () => {
    if (!selection.size) { toast("先选择日程"); return; }
    const ok = await confirmDialog({
      title: "批量删除",
      message: "将删除选中的 " + selection.size + " 条日程" + (selection.size > 1 ? "；重复日程会删除整个系列" : "") + "，无法恢复。",
      ok: "删除", danger: true,
    });
    if (!ok) return;
    for (const id of selection) await db.del("events", id);
    toast("已删除 " + selection.size + " 条", "ok");
    selection.clear();
    manageMode = false;
    window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "events" } }));
  };
}
