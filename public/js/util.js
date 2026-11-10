/* 通用工具：日期、重复规则、格式化 */
export const WEEKDAY_CN = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];
export const WEEKDAY_SHORT = ["一", "二", "三", "四", "五", "六", "日"];
export const WEEKDAY_MIN = ["日", "一", "二", "三", "四", "五", "六"];

export const EVENT_COLORS = {
  violet: { value: "#AF52DE", label: "系统紫" },
  teal: { value: "#30B0C7", label: "系统青" },
  amber: { value: "#FF9500", label: "系统橙" },
  rose: { value: "#FF2D55", label: "系统粉" },
  sky: { value: "#007AFF", label: "系统蓝" },
};
export const COLOR_ORDER = ["violet", "teal", "amber", "rose", "sky"];

/** 复旦课表节次时间（与教务处一致） */
export const PERIOD_TIMES = [
  { period: 1, start: "08:00", end: "08:45" },
  { period: 2, start: "08:55", end: "09:40" },
  { period: 3, start: "09:55", end: "10:40" },
  { period: 4, start: "10:50", end: "11:35" },
  { period: 5, start: "11:45", end: "12:30" },
  { period: 6, start: "13:30", end: "14:15" },
  { period: 7, start: "14:25", end: "15:10" },
  { period: 8, start: "15:25", end: "16:10" },
  { period: 9, start: "16:20", end: "17:05" },
  { period: 10, start: "17:15", end: "18:00" },
  { period: 11, start: "18:30", end: "19:15" },
  { period: 12, start: "19:25", end: "20:10" },
  { period: 13, start: "20:20", end: "21:05" },
  { period: 14, start: "21:15", end: "22:00" },
];

export const REMIND_OPTIONS = [
  { value: null, label: "不提醒" },
  { value: 0, label: "日程开始时" },
  { value: 5, label: "提前 5 分钟" },
  { value: 15, label: "提前 15 分钟" },
  { value: 30, label: "提前 30 分钟" },
  { value: 60, label: "提前 1 小时" },
  { value: 1440, label: "提前 1 天" },
];
export function remindLabel(minutes) {
  const hit = REMIND_OPTIONS.find((o) => o.value === minutes);
  if (hit) return hit.label;
  return minutes == null ? "不提醒" : "提前 " + minutes + " 分钟";
}

export const REPEAT_OPTIONS = [
  { value: "", label: "不重复" },
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
  { value: "yearly", label: "每年" },
];
export function repeatLabel(v) {
  const hit = REPEAT_OPTIONS.find((o) => o.value === v);
  return hit ? hit.label : "不重复";
}

export const pad2 = (n) => String(n).padStart(2, "0");
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export function stripTags(html) {
  const el = document.createElement("div");
  el.innerHTML = html || "";
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
export function debounce(fn, ms = 300) {
  let t = 0;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
export function throttle(fn, ms = 200) {
  let last = 0, timer = 0;
  return (...args) => {
    const now = Date.now();
    clearTimeout(timer);
    if (now - last >= ms) { last = now; fn(...args); }
    else timer = setTimeout(() => { last = Date.now(); fn(...args); }, ms - (now - last));
  };
}
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
export function downloadText(text, filename, type = "text/plain;charset=utf-8") {
  downloadBlob(new Blob([text], { type }), filename);
}
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/* ---------------- 日期 ---------------- */
export function dateStr(d = new Date()) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
export function parseDate(s) {
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function addDays(s, n) {
  const d = typeof s === "string" ? parseDate(s) : new Date(s);
  d.setDate(d.getDate() + n);
  return typeof s === "string" ? dateStr(d) : d;
}
export function addMonths(year, month, delta) {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
export function diffDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}
export function startOfWeek(s) {
  const d = parseDate(s);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return dateStr(d);
}
export function endOfWeek(s) {
  return addDays(startOfWeek(s), 6);
}
export function isoWeekNo(s) {
  const d = parseDate(s);
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target - firstThursday;
  return 1 + Math.round(diff / 86400000 / 7);
}
export function monthMatrix(year, month) {
  const first = new Date(year, month - 1, 1);
  const startDow = (first.getDay() + 6) % 7;
  const start = new Date(year, month - 1, 1 - startDow);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ date: dateStr(d), day: d.getDate(), inMonth: d.getMonth() === month - 1 });
  }
  return cells;
}
export function weekdayCN(s) { return WEEKDAY_CN[(parseDate(s).getDay() + 6) % 7]; }
export function fmtDateCN(s, withYear = false) {
  const d = parseDate(s);
  return (withYear ? d.getFullYear() + " 年 " : "") + (d.getMonth() + 1) + " 月 " + d.getDate() + " 日";
}
export function fmtTime(t) { return String(t || "").slice(0, 5); }
export function timeToMin(t) {
  const [h, m] = String(t || "0:0").split(":").map(Number);
  return h * 60 + m;
}
export function minToTime(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return pad2(Math.floor(m / 60)) + ":" + pad2(m % 60);
}
export function fmtRelative(ts) {
  const diff = Date.now() - Number(ts || 0);
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return Math.floor(diff / 60000) + " 分钟前";
  if (diff < 86400000) return Math.floor(diff / 3600000) + " 小时前";
  if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + " 天前";
  return dateStr(new Date(Number(ts)));
}
export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "夜深了";
  if (h < 9) return "早上好";
  if (h < 12) return "上午好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  if (h < 23) return "晚上好";
  return "夜深了";
}
export function weekdayOfDate(s) { return (parseDate(s).getDay() + 6) % 7; }

/* ---------------- 重复日程 ---------------- */
export function normalizeRepeat(v) {
  const t = String(v || "").trim().toLowerCase();
  const map = {
    "": "", none: "", never: "", "不重复": "",
    day: "daily", daily: "daily", "每天": "daily", "每日": "daily",
    week: "weekly", weekly: "weekly", "每周": "weekly",
    month: "monthly", monthly: "monthly", "每月": "monthly",
    year: "yearly", yearly: "yearly", "每年": "yearly",
  };
  return map[t] ?? (["daily", "weekly", "monthly", "yearly"].includes(t) ? t : "");
}
export function recurrenceDays(startDate, repeat, from, to, limit = 400, skip = [], until = "") {
  const kind = normalizeRepeat(repeat);
  const out = [];
  if (!kind) return out;
  const begin = parseDate(startDate);
  const low = parseDate(from);
  const high = parseDate(to);
  if (high < begin) return out;
  const skipSet = new Set(skip || []);
  if (kind === "daily") {
    let c = new Date(Math.max(begin, low));
    while (c <= high && out.length < limit) {
      const ds = dateStr(c);
      if (!until || ds <= until) out.push(ds);
      c.setDate(c.getDate() + 1);
    }
  } else if (kind === "weekly") {
    let c = new Date(begin);
    if (c < low) {
      const delta = Math.floor((low - c) / (86400000 * 7)) * 7;
      c.setDate(c.getDate() + delta);
      while (c < low) c.setDate(c.getDate() + 7);
    }
    while (c <= high && out.length < limit) {
      const ds = dateStr(c);
      if (!until || ds <= until) out.push(ds);
      c.setDate(c.getDate() + 7);
    }
  } else if (kind === "monthly") {
    let y = begin.getFullYear(), m = begin.getMonth(), guard = 0;
    while (guard++ < 600) {
      const cand = new Date(y, m, begin.getDate());
      if (cand.getDate() === begin.getDate() && cand >= begin && cand >= low && cand <= high) {
        const ds = dateStr(cand);
        if (!until || ds <= until) out.push(ds);
      }
      if (y > high.getFullYear() || (y === high.getFullYear() && m > high.getMonth())) break;
      m += 1; if (m > 11) { m = 0; y += 1; }
      if (out.length >= limit) break;
    }
  } else if (kind === "yearly") {
    for (let y = begin.getFullYear(); y <= high.getFullYear(); y++) {
      const cand = new Date(y, begin.getMonth(), begin.getDate());
      if (cand.getMonth() !== begin.getMonth()) continue;
      if (cand >= begin && cand >= low && cand <= high) {
        const ds = dateStr(cand);
        if (!until || ds <= until) out.push(ds);
      }
      if (out.length >= limit) break;
    }
  }
  return out.filter((d) => !skipSet.has(d));
}

/** 把日程在某段时间里展开成实例（保持原 id，附加 instanceDate） */
export function eventInstances(events, from, to) {
  const out = [];
  for (const ev of events) {
    if (!ev.repeat) {
      if (ev.date >= from && ev.date <= to) out.push({ ...ev, instanceDate: ev.date });
      continue;
    }
    const days = recurrenceDays(ev.date, ev.repeat, from, to, 400, ev.repeatSkip || [], ev.repeatUntil || "");
    for (const d of days) out.push({ ...ev, instanceDate: d });
  }
  out.sort((a, b) => (a.instanceDate + (a.start || "")).localeCompare(b.instanceDate + (b.start || "")));
  return out;
}
export function eventsOnDay(events, day) {
  return eventInstances(events, day, day)
    .sort((a, b) => timeToMin(a.start || "00:00") - timeToMin(b.start || "00:00"));
}
export function instanceKey(evId, day) { return evId + "@" + day; }

/** 某一天的实例是否已完成（兼容旧的 series-level done） */
export function isDoneOn(ev, day) {
  if (Array.isArray(ev.doneDates)) {
    if (ev.doneDates.includes(day)) return true;
    if (ev.doneDates.length) return false;
  }
  if (!ev.done) return false;
  // 旧数据只有 done：非重复日程看当天，重复日程只认原始那天
  return String(ev.date).slice(0, 10) === String(day).slice(0, 10);
}

/** 生成只改了「某一天完成状态」的新对象 */
export function withDoneOn(ev, day, done) {
  const set = new Set(Array.isArray(ev.doneDates) ? ev.doneDates : []);
  if (!Array.isArray(ev.doneDates) && ev.done && String(ev.date).slice(0, 10) === String(day).slice(0, 10)) {
    set.add(String(day).slice(0, 10));
  }
  if (done) set.add(String(day).slice(0, 10));
  else set.delete(String(day).slice(0, 10));
  const doneDates = Array.from(set).sort();
  return {
    ...ev,
    doneDates,
    done: ev.repeat ? 0 : (doneDates.includes(String(ev.date).slice(0, 10)) ? 1 : 0),
    updatedAt: Date.now(),
  };
}

/* ---------------- 其它 ---------------- */
export function parseJSON(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}
export function formatTimeRange(start, end) {
  const s = fmtTime(start), e = fmtTime(end);
  return e ? s + " – " + e : s;
}
export function initials(name) {
  const t = String(name || "").trim();
  if (!t) return "?";
  const first = t[0];
  return /[a-zA-Z]/.test(first) ? first.toUpperCase() : first;
}
export function cssVarColor(key) {
  return (EVENT_COLORS[key] && EVENT_COLORS[key].value) || "#2F7A5F";
}
export function readFile(file, mode = "dataurl") {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    if (mode === "text") fr.readAsText(file);
    else if (mode === "array") fr.readAsArrayBuffer(file);
    else fr.readAsDataURL(file);
  });
}
export function weekDays(from) {
  const start = startOfWeek(from);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${()|[\]\\]/g, "\\$&");
}
