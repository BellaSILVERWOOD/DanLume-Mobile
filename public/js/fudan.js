/* 复旦账号：登录、课表同步、教务通知、eHall 信息 */
import { bridgeFetch, bridge } from "./api.js";
import { db, getSetting, setSetting } from "./db.js";
import {
  dateStr, addDays, parseDate, uid, PERIOD_TIMES, pad2,
} from "./util.js";

const COURSE_TABLE = "https://fdjwgl.fudan.edu.cn/student/for-std/course-table";
const JWC_LIST = "https://jwc.fudan.edu.cn/9397/list.htm";
const POSTGRAD_TABLE = "https://yjsxk.fudan.edu.cn/yjsxkapp/sys/xsxkappfudan/xsxkCourse/loadKbxx.do";

function fudanBase() {
  // APK 里复旦接口由应用内本地服务提供，不受「本地服务地址」设置影响
  if (/DanLumeApp/.test(navigator.userAgent)) return location.origin;
  return bridge() || location.origin;
}

async function api(path, body, method = "POST") {
  return bridgeFetch("/api/fudan/" + path, method === "GET" ? undefined : body, {
    method,
    timeout: 90000,
    base: fudanBase(),
  });
}

export function fudanStatus() { return api("status", undefined, "GET"); }
export function fudanLogin(username, password, remember = true) {
  return api("login", { username, password, remember });
}
export function fudanAutologin() { return api("autologin", {}); }
export function fudanLogout(clear = true) { return api("logout", { clear }); }
export function fudanProxy(url, opts = {}) {
  return api("proxy", { url, method: opts.method || "GET", body: opts.body || "", contentType: opts.contentType || "" });
}

export function saveProfile(profile) {
  if (!profile) return Promise.resolve();
  const name = profile.name || profile.id || "";
  const type = String(profile.type || "");
  const jobs = [
    setSetting("fudanId", profile.id || ""),
    setSetting("fudanName", name),
    setSetting("fudanDept", profile.department || ""),
    setSetting("fudanType", type),
    setSetting("fudanLoggedIn", "1"),
    setSetting("userName", name),
    setSetting("userSchool", "复旦大学"),
  ];
  if (/研究生|硕士|博士/.test(type)) jobs.push(setSetting("fudanLevel", "postgraduate"));
  else if (/本科/.test(type)) jobs.push(setSetting("fudanLevel", "undergraduate"));
  return Promise.all(jobs);
}
export async function clearProfile() {
  await Promise.all([
    setSetting("fudanId", ""), setSetting("fudanName", ""), setSetting("fudanDept", ""),
    setSetting("fudanType", ""), setSetting("fudanLoggedIn", "0"), setSetting("fudanSyncAt", "0"),
  ]);
}
export function isFudanLoggedIn() { return getSetting("fudanLoggedIn", "0") === "1"; }

/* ---------------- 课表解析 ---------------- */

export function parseSemestersHtml(html) {
  const match = /(?:var|let|const)\s+semesters\s*=\s*JSON\.parse\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)/.exec(html || "");
  if (!match) throw new Error("学校课表页面结构已更新（未找到学期列表）");
  let text;
  if (match[1][0] === '"') {
    text = JSON.parse(match[1]);
  } else {
    text = match[1].slice(1, -1)
      .replace(/\\([\\'"/])/g, "$1")
      .replace(/\\x([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
  }
  let rows;
  try { rows = JSON.parse(text); } catch (e) { throw new Error("学期列表解析失败"); }
  if (!Array.isArray(rows) || !rows.length) throw new Error("学期列表是空的");
  const semesters = rows.map((row) => ({
    id: String(row.id),
    name: String(row.name || ""),
    startDate: typeof row.startDate === "string" ? row.startDate.slice(0, 10) : "",
  })).reverse();
  let selectedId = "";
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const opt = doc.querySelector("#allSemesters option[selected]") || doc.querySelector("#allSemesters option");
    if (opt) selectedId = opt.getAttribute("value") || "";
  } catch (e) {}
  if (!selectedId || !semesters.some((s) => s.id === selectedId)) selectedId = semesters[0].id;
  return { semesters, selectedId };
}

export function parseCourseData(text) {
  const json = JSON.parse(text);
  if (json && Array.isArray(json.studentTableVms)) {
    const activities = (json.studentTableVms[0] && json.studentTableVms[0].activities) || [];
    return activities.map((a, index) => {
      const rawWeeks = Array.isArray(a.weekIndexes)
        ? a.weekIndexes
        : String(a.weekIndexes || "").split(/[,\s]+/).filter(Boolean);
      return {
        id: String(a.lessonId || "") + "-" + String(a.lessonCode || "") + "-" + index,
        name: String(a.courseName || "").trim(),
        room: String(a.room || "").trim(),
        teachers: Array.isArray(a.teachers) ? a.teachers.map((t) => String(t).trim()).filter(Boolean) : [],
        weekday: Number(a.weekday),
        startUnit: Number(a.startUnit),
        endUnit: Number(a.endUnit || a.startUnit),
        weeks: Array.from(new Set(rawWeeks.map(Number))).filter((w) => w >= 1).sort((x, y) => x - y),
      };
    }).filter((a) => a.name && a.weekday >= 1 && a.weekday <= 7 && a.startUnit >= 1 && a.weeks.length);
  }
  if (json && Array.isArray(json.results)) {
    const list = json.results.map((row, index) => {
      const bits = String(row.ZCBH || "");
      if (!/^[01]+$/.test(bits)) return null;
      const weeks = [];
      for (let i = 0; i < bits.length; i++) if (bits[i] === "1") weeks.push(i + 1);
      return {
        id: "pg-" + index,
        name: String(row.KCMC || "").trim(),
        room: String(row.JASMC || "").trim(),
        teachers: row.JSXM ? [String(row.JSXM).trim()] : [],
        weekday: Number(row.XQ),
        startUnit: Number(row.KSJCDM),
        endUnit: Number(row.JSJCDM || row.KSJCDM),
        weeks,
      };
    }).filter(Boolean);
    const merged = [];
    for (const course of list) {
      const prev = merged.find((x) => x.name === course.name && x.room === course.room &&
        x.weekday === course.weekday && x.endUnit + 1 === course.startUnit &&
        JSON.stringify(x.weeks) === JSON.stringify(course.weeks) &&
        JSON.stringify(x.teachers) === JSON.stringify(course.teachers));
      if (prev) prev.endUnit = course.endUnit; else merged.push(course);
    }
    return merged;
  }
  throw new Error("课表数据格式无法识别");
}

/** 第一周星期一：学校给的第一周开始日期可能是周日 */
export function week1Monday(startDate) {
  if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    const d = parseDate(startDate);
    const dow = d.getDay();
    return addDays(startDate, dow === 0 ? 1 : 1 - dow);
  }
  const now = new Date();
  const y = now.getFullYear();
  const fallback = now.getMonth() + 1 >= 8 ? y + "-09-01" : y + "-02-17";
  return week1Monday(fallback);
}

export function buildCourseEvents(activities, semester) {
  const monday = week1Monday(semester.startDate || getSetting("termStart", ""));
  const events = [];
  let maxWeek = 1;
  for (const a of activities) {
    const weeks = a.weeks && a.weeks.length ? a.weeks : [1];
    const last = Math.max(...weeks);
    maxWeek = Math.max(maxWeek, last);
    const first = addDays(monday, (1 - 1) * 7 + (a.weekday - 1));
    const lastDate = addDays(monday, (last - 1) * 7 + (a.weekday - 1));
    const weekSet = new Set(weeks);
    const skip = [];
    for (let w = 1; w <= last; w++) {
      if (!weekSet.has(w)) skip.push(addDays(monday, (w - 1) * 7 + (a.weekday - 1)));
    }
    const s = PERIOD_TIMES[a.startUnit - 1] || PERIOD_TIMES[0];
    const e = PERIOD_TIMES[a.endUnit - 1] || s;
    const info = [];
    if (a.teachers.length) info.push(a.teachers.join("、"));
    info.push("第 " + weeks[0] + (last > weeks[0] ? "-" + last : "") + " 周");
    if (a.room) info.push(a.room);
    events.push({
      id: uid(),
      title: a.name,
      description: info.join(" · "),
      date: first,
      start: s.start,
      end: e.end,
      location: a.room || "",
      color: "teal",
      remind: 10,
      repeat: last > 1 ? "weekly" : "",
      repeatSkip: skip,
      repeatUntil: last > 1 ? lastDate : "",
      done: 0,
      notified: "",
      groupId: "",
      source: "fudan",
      courseKey: a.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  events.sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
  return { events, startDate: monday, totalWeeks: maxWeek };
}

/* ---------------- 同步 ---------------- */

export async function syncTimetable() {
  const level = getSetting("fudanLevel", "undergraduate");
  let semester;
  let activities;
  if (level === "postgraduate") {
    const data = await fudanProxy(POSTGRAD_TABLE + "?_=" + Date.now());
    if (!data.ok) throw new Error(data.error || "读取研究生课表失败");
    activities = parseCourseData(data.body);
    semester = { id: "pg", name: "研究生课表", startDate: getSetting("termStart", "") };
  } else {
    const page = await fudanProxy(COURSE_TABLE);
    if (!page.ok) throw new Error(page.error || "读取课表页面失败");
    if (page.status !== 200) throw new Error("课表页面返回 " + page.status + "，可能登录已过期");
    const parsed = parseSemestersHtml(page.body);
    semester = parsed.semesters.find((s) => s.id === parsed.selectedId) || parsed.semesters[0];
    const data = await fudanProxy(COURSE_TABLE + "/semester/" + encodeURIComponent(semester.id) + "/print-data");
    if (!data.ok) throw new Error(data.error || "读取课表数据失败");
    activities = parseCourseData(data.body);
  }
  if (!activities.length) throw new Error("本学期课表还是空的");
  const built = buildCourseEvents(activities, semester);

  const existing = await db.all("events");
  const oldFudan = existing.filter((e) => e.source === "fudan");
  const byCourse = new Map();
  for (const ev of oldFudan) if (ev.courseKey) byCourse.set(ev.courseKey, ev);
  const newKeys = new Set(built.events.map((e) => e.courseKey));
  for (const ev of built.events) {
    const old = byCourse.get(ev.courseKey);
    if (old) {
      ev.id = old.id;
      ev.doneDates = Array.isArray(old.doneDates) ? old.doneDates : (old.done ? [old.date] : []);
      ev.repeatSkip = Array.from(new Set([...(old.repeatSkip || []), ...(ev.repeatSkip || [])]));
      if (old.remind != null) ev.remind = old.remind;
      ev.color = "teal";
    }
    await db.put("events", ev);
  }
  for (const ev of oldFudan) {
    if (!ev.courseKey || !newKeys.has(ev.courseKey)) await db.del("events", ev.id);
  }
  await setSetting("termStart", built.startDate);
  await setSetting("totalWeeks", String(built.totalWeeks));
  await setSetting("fudanSemester", semester.name || "本学期");
  window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "events" } }));
  return { count: built.events.length, semester: semester.name, startDate: built.startDate, totalWeeks: built.totalWeeks };
}

export function parseNoticesHtml(html, baseUrl = JWC_LIST) {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  const table = doc.querySelector(".wp_article_list_table") || doc;
  const anchors = Array.from(table.querySelectorAll("a[href]"));
  const seen = new Set();
  const out = [];
  for (const a of anchors) {
    const href = a.getAttribute("href") || "";
    if (!/page\.htm/.test(href)) continue;
    let url;
    try { url = new URL(href, baseUrl).href; } catch (e) { continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    const title = (a.getAttribute("title") || a.textContent || "").trim();
    if (!title || title.length < 4) continue;
    let date = "";
    const tr = a.closest("tr");
    if (tr) {
      const cell = tr.querySelector("td.ti");
      const raw = cell ? cell.textContent.trim() : tr.textContent;
      const m = /(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(raw);
      if (m) date = m[1] + "-" + pad2(m[2]) + "-" + pad2(m[3]);
    }
    out.push({ title, url, publishedAt: date });
    if (out.length >= 40) break;
  }
  return out;
}

export async function syncNotices() {
  const page = await fudanProxy(JWC_LIST);
  if (!page.ok) throw new Error(page.error || "读取教务通知失败");
  const items = parseNoticesHtml(page.body, page.url || JWC_LIST);
  if (!items.length) throw new Error("教务通知页面没有解析到内容");
  const existing = await db.all("notices");
  const byUrl = new Map(existing.map((n) => [n.url, n]));
  let added = 0;
  for (const item of items) {
    if (byUrl.has(item.url)) continue;
    await db.put("notices", {
      id: "n" + Math.random().toString(36).slice(2, 10),
      source: "教务",
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt || "",
      read: 0,
      fetchedAt: Date.now(),
    });
    added++;
  }
  window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "notices" } }));
  return { added, total: items.length };
}

export async function syncFudanAll(onStep = () => {}) {
  onStep("正在确认登录状态…");
  const status = await fudanStatus();
  if (!status.ok || !status.loggedIn) throw new Error(status.error || "复旦账号未登录");
  await saveProfile(status.profile);
  const result = { profile: status.profile, timetable: null, notices: null, errors: [] };
  onStep("正在同步本学期课表…");
  try {
    result.timetable = await syncTimetable();
  } catch (e) {
    result.errors.push("课表：" + (e.message || e));
  }
  onStep("正在抓取教务通知…");
  try {
    result.notices = await syncNotices();
  } catch (e) {
    result.errors.push("通知：" + (e.message || e));
  }
  await setSetting("fudanSyncAt", String(Date.now()));
  return result;
}

export function lastSyncText() {
  const ts = Number(getSetting("fudanSyncAt", "0")) || 0;
  if (!ts) return "还没有同步过";
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return "刚刚同步";
  if (min < 60) return min + " 分钟前同步";
  return Math.floor(min / 60) + " 小时前同步";
}
