/* 让 AI「动手」：本地工具（日程 / 备忘 / 查询） */
import { db, addRow } from "./db.js";
import { dateStr, addDays, eventsOnDay, eventInstances, fmtDateCN, weekdayCN, timeToMin, uid, isDoneOn } from "./util.js";
import { fetchWeather, weatherInfo } from "./weather.js";

const today = () => dateStr();

function normDate(s) {
  if (!s) return today();
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (t === "今天") return today();
  if (t === "明天") return addDays(today(), 1);
  if (t === "后天") return addDays(today(), 2);
  if (t === "昨天") return addDays(today(), -1);
  const m = t.match(/^(\d{1,2})[月./-](\d{1,2})/);
  if (m) {
    const y = new Date().getFullYear();
    return y + "-" + String(m[1]).padStart(2, "0") + "-" + String(m[2]).padStart(2, "0");
  }
  return today();
}

export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "add_event",
      description: "在日历里新建一条日程。用户说「提醒我 / 安排 / 约」时使用。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "日程标题" },
          date: { type: "string", description: "YYYY-MM-DD，今天是 " + today() },
          start_time: { type: "string", description: "HH:MM，默认 09:00" },
          end_time: { type: "string", description: "HH:MM，可选" },
          location: { type: "string" },
          description: { type: "string" },
          remind_minutes: { type: "integer", description: "提前多少分钟提醒，0 表示开始时，缺省 15" },
          repeat: { type: "string", enum: ["", "daily", "weekly", "monthly", "yearly"] },
        },
        required: ["title", "date", "start_time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_events",
      description: "查询某段日期内的日程。不传日期默认查今天。",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "YYYY-MM-DD" },
          to: { type: "string", description: "YYYY-MM-DD" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_event",
      description: "删除日历里的日程/任务。优先传 id（先用 list_events 查到 id）；也可以传 title 精确匹配。重复日程会删除整个系列。",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "日程 id，来自 list_events" },
          title: { type: "string", description: "日程标题，精确匹配" },
          date: { type: "string", description: "YYYY-MM-DD，可选；只匹配这一天的实例" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_memo",
      description: "新建一条备忘（速记 / 想法 / 清单）。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string", description: "正文，纯文本，可用换行" },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_memos",
      description: "在备忘里搜索关键词。",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "查询指定城市的当前天气与未来三天预报。",
      parameters: { type: "object", properties: { city: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "daily_brief",
      description: "获取今天的日程、未读通知、待办作业等摘要，用来回答「今天有什么安排」。",
      parameters: { type: "object", properties: {} },
    },
  },
];

export async function executeTool(name, args) {
  const a = args || {};
  try {
    if (name === "add_event") {
      const ev = {
        id: uid(),
        title: a.title || "未命名日程",
        date: normDate(a.date),
        start: (a.start_time || "09:00").slice(0, 5),
        end: (a.end_time || "").slice(0, 5),
        location: a.location || "",
        description: a.description || (a.description === undefined && a.note) || "",
        color: "violet",
        remind: a.remind_minutes === undefined ? 15 : a.remind_minutes,
        repeat: a.repeat || "",
        repeatSkip: [],
        repeatUntil: "",
        done: 0,
        notified: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: "ai",
      };
      await db.put("events", ev);
      window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "events" } }));
      return JSON.stringify({ ok: true, created: ev.title + " · " + ev.date + " " + ev.start, id: ev.id });
    }
    if (name === "list_events") {
      const from = normDate(a.from || today());
      const to = normDate(a.to || from);
      const all = await db.all("events");
      const out = [];
      for (let d = from; d <= to && out.length < 60; d = addDays(d, 1)) {
        for (const ev of eventsOnDay(all, d)) {
          out.push({ id: ev.id, date: ev.instanceDate, time: ev.start + (ev.end ? "-" + ev.end : ""), title: ev.title, done: isDoneOn(ev, ev.instanceDate) });
        }
      }
      return JSON.stringify(out);
    }
    if (name === "delete_event") {
      const all = await db.all("events");
      const id = String(a.id || "").trim();
      let matched = [];
      if (id) {
        matched = all.filter((e) => e.id === id);
      } else {
        const title = String(a.title || "").trim();
        if (!title) return JSON.stringify({ ok: false, error: "请提供要删除的日程 id 或 title" });
        matched = all.filter((e) => String(e.title || "").trim() === title);
        if (a.date) {
          const day = normDate(a.date);
          matched = matched.filter((e) => e.date === day || (e.repeat && eventInstances([e], day, day).length));
        }
      }
      if (!matched.length) return JSON.stringify({ ok: false, error: "没有找到匹配的日程" });
      if (matched.length > 1) {
        return JSON.stringify({
          ok: false,
          error: "匹配到多条同名日程，请先用 list_events 查 id，再按 id 删除",
          candidates: matched.slice(0, 10).map((e) => ({ id: e.id, title: e.title, date: e.date, start: e.start })),
        });
      }
      const ev = matched[0];
      await db.del("events", ev.id);
      window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "events" } }));
      return JSON.stringify({ ok: true, deleted: { id: ev.id, title: ev.title, date: ev.date, start: ev.start }, note: ev.repeat ? "已删除整个重复系列" : "已删除" });
    }
    if (name === "add_memo") {
      const memo = {
        id: uid(), title: a.title || "来自 Lume 的备忘",
        html: "<p>" + String(a.content || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "</p><p>") + "</p>",
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      await db.put("memos", memo);
      window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "memos" } }));
      return JSON.stringify({ ok: true, id: memo.id });
    }
    if (name === "search_memos") {
      const q = String(a.query || "").toLowerCase();
      const memos = await db.all("memos");
      const out = memos.filter((m) => (m.title + " " + (m.html || "")).toLowerCase().includes(q)).slice(0, 8)
        .map((m) => ({ title: m.title, snippet: String(m.html || "").replace(/<[^>]+>/g, " ").slice(0, 160) }));
      return JSON.stringify(out);
    }
    if (name === "get_weather") {
      const w = await fetchWeather("31.2304", "121.4737");
      const [desc, emoji] = weatherInfo(w.code);
      return JSON.stringify({
        city: a.city || "上海", desc, emoji, temp: w.temp, feels: w.feels,
        humidity: w.humidity, wind: w.wind,
        daily: w.daily.map((d) => ({ date: d.date, desc: weatherInfo(d.code)[0], min: d.min, max: d.max })),
      });
    }
    if (name === "daily_brief") {
      const all = await db.all("events");
      const todayEvents = eventsOnDay(all, today()).map((e) => ({
        time: e.start + (e.end ? "-" + e.end : ""), title: e.title, done: isDoneOn(e, e.instanceDate), location: e.location || "",
      }));
      const notices = (await db.all("notices")).filter((n) => !n.read).slice(0, 5).map((n) => n.title);
      const hw = (await db.all("homework")).filter((h) => h.status !== "done").sort((x, y) => (x.due || "").localeCompare(y.due || "")).slice(0, 5)
        .map((h) => ({ course: h.course, title: h.title, due: h.due }));
      const memos = (await db.all("memos")).slice(0, 3).map((m) => m.title);
      return JSON.stringify({ today: fmtDateCN(today()), weekday: weekdayCN(today()), events: todayEvents, unreadNotices: notices, homework: hw, recentMemos: memos });
    }
    return JSON.stringify({ error: "未知工具：" + name });
  } catch (e) {
    return JSON.stringify({ error: String(e && e.message || e) });
  }
}
