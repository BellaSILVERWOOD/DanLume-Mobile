/* 空教室：校区 → 教学楼 → 教室，横向时间轴 */
import { getSetting, db } from "../db.js";
import { setHeader } from "../shell.js";
import { icon } from "../icons.js";
import { esc, toast, openSheet } from "../ui.js";
import { bridgeFetch, bridge } from "../api.js";
import { dateStr, weekdayCN, fmtDateCN } from "../util.js";

const CAMPUSES = {
  "邯郸校区": { buildings: { "第三教学楼": ["3101", "3105", "3106", "3108"], "光华楼": ["西辅楼 101", "西辅楼 201"], "第二教学楼": ["2201", "2202", "2301"] } },
  "江湾校区": { buildings: { "智华楼": ["A101", "A201"], "生命科学楼": ["B101"] } },
  "枫林校区": { buildings: { "治道楼": ["101", "201"], "明道楼": ["301"] } },
  "张江校区": { buildings: { "行政楼": ["101"], "微电子楼": ["201"] } },
};
const PERIODS = [
  [1, "08:00"], [2, "08:55"], [3, "09:55"], [4, "10:50"], [5, "11:45"],
  [6, "13:30"], [7, "14:25"], [8, "15:25"], [9, "16:20"], [10, "17:15"],
  [11, "18:30"], [12, "19:25"],
];
const SAMPLE_COURSES = ["高等数学", "大学物理", "数据结构", "线性代数", "英语", "思政", "体育", "概率论", "计算机系统", "经济学原理"];

let state = { campus: "邯郸校区", building: "第三教学楼", date: dateStr(), remote: null, loading: false };
let rootEl = null;

export async function render(root) {
  rootEl = root;
  setHeader("空教室", fmtDateCN(state.date) + " · " + weekdayCN(state.date), [
    { icon: "refresh", title: "查询", onClick: () => query(true) },
  ]);
  paint();
  return () => {};
}

function seed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

function slotsFor(room) {
  const key = room + "|" + state.date;
  const base = seed(key);
  const slots = Array.from({ length: PERIODS.length }, () => null);
  const busyCount = 2 + (base % 4);
  for (let i = 0; i < busyCount; i++) {
    const idx = (base + i * 7 + i * i * 3) % PERIODS.length;
    const course = SAMPLE_COURSES[(base + i * 5) % SAMPLE_COURSES.length];
    slots[idx] = { course, teacher: ["王", "李", "张", "陈"][(base + i) % 4] + "老师", room };
  }
  for (let i = 1; i < slots.length; i++) {
    if (slots[i] && slots[i - 1] && slots[i].course === slots[i - 1].course) slots[i] = null;
  }
  return slots;
}

function paint() {
  const buildings = Object.keys(CAMPUSES[state.campus].buildings);
  if (!buildings.includes(state.building)) state.building = buildings[0];
  const rooms = CAMPUSES[state.campus].buildings[state.building];
  rootEl.innerHTML =
    '<div class="card tight">' +
      '<div class="row" style="gap:8px;margin-bottom:8px"><span class="badge accent">' + esc(state.campus) + "</span>" +
        '<span class="spacer"></span><span class="tiny muted">' + fmtDateCN(state.date) + " " + weekdayCN(state.date) + "</span></div>" +
      '<div class="input-row" style="margin-bottom:8px">' +
        '<select class="input" id="cr-campus">' + Object.keys(CAMPUSES).map((c) => '<option ' + (c === state.campus ? "selected" : "") + ">" + c + "</option>").join("") + "</select>" +
        '<select class="input" id="cr-building">' + buildings.map((b) => '<option ' + (b === state.building ? "selected" : "") + ">" + b + "</option>").join("") + "</select>" +
      "</div>" +
      '<div class="input-row"><input class="input" id="cr-date" type="date" value="' + state.date + '" />' +
        '<button class="btn small primary" id="cr-query" style="flex:0 0 auto">查询</button></div>' +
    "</div>" +
    '<div class="timeline-legend"><span><i style="background:color-mix(in srgb, var(--ok) 25%, transparent)"></i>空闲</span>' +
      '<span><i style="background:color-mix(in srgb, #E48A96 45%, transparent)"></i>有课</span>' +
      '<span class="spacer"></span><span>' + esc(state.building) + " · " + rooms.length + " 间</span></div>" +
    '<div class="card tight">' + rooms.map((room) => {
      const slots = slotsFor(room);
      return '<div class="room-row"><div class="room-name">' + esc(room) + "</div><div class=\"room-track\">" +
        slots.map((s, i) => s
          ? '<div class="room-slot busy" title="' + esc(s.course) + '" data-room="' + esc(room) + '" data-slot="' + i + '"><span>' + esc(s.course.slice(0, 2)) + "</span></div>"
          : '<div class="room-slot" data-room="' + esc(room) + '" data-slot="' + i + '"></div>').join("") +
        "</div></div>";
    }).join("") +
    '<div class="row" style="margin-top:10px;overflow-x:auto;gap:0;font-size:9px;color:var(--faint)">' +
      PERIODS.map(([n]) => '<span style="flex:1;text-align:center">' + n + "</span>").join("") + "</div></div>" +
    '<div class="card flat" style="margin-top:12px">' +
      '<div class="row"><span class="card-ico">' + icon("info") + '</span><span class="small bold">数据说明</span><span class="spacer"></span>' +
      '<span class="badge">' + (state.remote ? "来自网页" : "示例数据") + "</span></div>" +
      '<div class="hint" style="margin-top:6px;padding:0">' + (state.remote ? "以下是配置的教室查询页面返回的文字摘要。" : "没有配置教室查询地址时，页面用示例数据展示时间轴。到「设置 → 教务与 eHall」填查询地址后，可尝试抓取真实页面。") + "</div>" +
      (state.remote ? '<pre class="code-block" style="max-height:220px;overflow:auto;margin-top:10px">' + esc(state.remote) + "</pre>" : "") +
      '<button class="btn small ghost" style="margin-top:10px" id="cr-source">' + icon("link") + "数据源设置</button></div>" +
    '<div style="height:16px"></div>';

  const $ = (id) => rootEl.querySelector("#" + id);
  $("cr-campus").onchange = (e) => { state.campus = e.target.value; state.building = Object.keys(CAMPUSES[state.campus].buildings)[0]; paint(); };
  $("cr-building").onchange = (e) => { state.building = e.target.value; paint(); };
  $("cr-date").onchange = (e) => { state.date = e.target.value || dateStr(); paint(); };
  $("cr-query").onclick = () => query(true);
  $("cr-source").onclick = () => { location.hash = "#/settings?card=campus"; };
  rootEl.querySelectorAll("[data-slot]").forEach((n) => {
    const room = n.dataset.room;
    const idx = Number(n.dataset.slot);
    const slot = slotsFor(room)[idx];
    n.onclick = () => {
      if (slot) toast(room + " · 第 " + PERIODS[idx][0] + " 节 · " + slot.course + " · " + slot.teacher);
      else toast(room + " · 第 " + PERIODS[idx][0] + " 节空闲（" + PERIODS[idx][1] + "）", "ok");
    };
  });
}

async function query(showToast) {
  const url = getSetting("classroomUrl", "");
  if (!url) { if (showToast) toast("先在设置里填写教室查询地址"); return; }
  if (!bridge()) { if (showToast) toast("需要先启动本地服务", "err"); return; }
  try {
    const data = await bridgeFetch("/api/web/fetch", { url, limit: 6000 }, { timeout: 30000 });
    state.remote = data.text || "";
    if (showToast) toast("已抓取页面", "ok");
  } catch (e) {
    state.remote = "";
    if (showToast) toast("抓取失败：" + (e.message || e), "err");
  }
  paint();
}
