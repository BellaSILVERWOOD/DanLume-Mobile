/* IndexedDB 持久层 + 设置缓存 + 备份 */
import { uid, dateStr, addDays } from "./util.js";

const DB_NAME = "danlume-mobile";
const DB_VERSION = 1;
const STORES = {
  events: { keyPath: "id" },
  memos: { keyPath: "id" },
  mails: { keyPath: "id" },
  notices: { keyPath: "id" },
  homework: { keyPath: "id" },
  docs: { keyPath: "id" },
  lits: { keyPath: "id" },
  litProjects: { keyPath: "id" },
  chats: { keyPath: "id" },
  focus: { keyPath: "id" },
  files: { keyPath: "id" },
  settings: { keyPath: "k" },
  meta: { keyPath: "k" },
};

let _db = null;
let _opening = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  if (_opening) return _opening;
  _opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const [name, cfg] of Object.entries(STORES)) {
        if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, cfg);
      }
    };
    req.onsuccess = () => { _db = req.result; _opening = null; resolve(_db); };
    req.onerror = () => { _opening = null; reject(req.error); };
  });
  return _opening;
}

function tx(store, mode = "readonly") {
  return openDB().then((d) => d.transaction(store, mode).objectStore(store));
}
function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const db = {
  async all(store) {
    const s = await tx(store);
    const rows = await wrap(s.getAll());
    return rows || [];
  },
  async get(store, key) {
    const s = await tx(store);
    return wrap(s.get(key));
  },
  async put(store, value) {
    const s = await tx(store, "readwrite");
    await wrap(s.put(value));
    return value;
  },
  async del(store, key) {
    const s = await tx(store, "readwrite");
    return wrap(s.delete(key));
  },
  async clear(store) {
    const s = await tx(store, "readwrite");
    return wrap(s.clear());
  },
  async count(store) {
    const s = await tx(store);
    return wrap(s.count());
  },
};

/* ---------------- 设置 ---------------- */
const _settings = new Map();
export const DEFAULT_SETTINGS = {
  theme: "light",
  accent: "#007AFF",
  accent2: "#34C759",
  bg: "linen",
  font: "system",
  glass: "1",
  reminders: "1",
  reminderSound: "1",
  departureRemind: "0",
  departureMinutes: "20",
  weatherCity: "上海",
  weatherLat: "31.2304",
  weatherLon: "121.4737",
  termStart: "",
  totalWeeks: "18",
  weekStart: "mon",
  userName: "",
  userSchool: "",
  apiBase: "",
  apiKey: "",
  apiModel: "",
  apiEffort: "high",
  apiThinking: "1",
  apiTools: "1",
  systemPrompt: "你是 Lume（卢梅），DanLume 里的写作与学习助手。回答用简体中文，简洁直接，先给结论再给要点；不确定的地方要说明不确定，不要编造。",
  sceneWeekly: "把下面这一周的日程与完成情况整理成周报：分「本周完成」「遇到的问题」「下周计划」三段，每段用短句，不要客套话，总字数控制在 400 字以内。",
  sceneHomework: "阅读这份课件/作业，输出：1) 三句话摘要；2) 需要动手完成的任务清单；3) 截止时间（如果提到了）；4) 需要用到的知识点。",
  sceneLatex: "把这段自然语言里的数学内容转成 LaTeX 公式，只用数学模式内容，不要加解释文字；多个公式用换行分隔。",
  bridgeUrl: "",
  ehallUrl: "https://ehall.fudan.edu.cn",
  elearningUrl: "https://elearning.fudan.edu.cn",
  classroomUrl: "",
  reportTo: "",
  reportSubject: "工作汇报",
  smtpHost: "",
  smtpPort: "465",
  smtpUser: "",
  smtpFromName: "",
  imapHost: "",
  imapPort: "993",
  imapUser: "",
  seeded: "0",
  onboarded: "0",
};

export async function loadSettings() {
  const rows = await db.all("settings");
  for (const row of rows) _settings.set(row.k, row.v);
  return _settings;
}
export function getSetting(k, fallback) {
  if (_settings.has(k)) return _settings.get(k);
  return fallback !== undefined ? fallback : (DEFAULT_SETTINGS[k] ?? "");
}
export async function setSetting(k, v) {
  _settings.set(k, v);
  await db.put("settings", { k, v });
  return v;
}
export async function setSettings(obj) {
  const entries = Object.entries(obj);
  for (const [k, v] of entries) {
    _settings.set(k, v);
    await db.put("settings", { k, v });
  }
}
export function allSettings() {
  const out = {};
  for (const [k, v] of _settings) out[k] = v;
  return out;
}

/* ---------------- 通用 CRUD 辅助 ---------------- */
export async function addRow(store, obj) {
  const row = { id: uid(), createdAt: Date.now(), updatedAt: Date.now(), ...obj };
  await db.put(store, row);
  return row;
}
export async function updateRow(store, id, patch) {
  const cur = await db.get(store, id);
  if (!cur) return null;
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  await db.put(store, next);
  return next;
}

/* 默认强调色切到 iOS 蓝；老用户如果还用着旧鼠尾草绿，迁移一次 */
export async function normalizeIosTheme() {
  if (getSetting("iosThemeV1") === "1") return;
  if (getSetting("accent") === "#2F7A5F") await setSetting("accent", "#007AFF");
  if (getSetting("accent2") === "#D99A4E") await setSetting("accent2", "#34C759");
  await setSetting("iosThemeV1", "1");
}

/* 旧版本课表颜色是按课程名随机分配的，统一迁移成同一种颜色 */
export async function normalizeCourseColors() {
  if (getSetting("courseColorV1") === "1") return;
  try {
    const events = await db.all("events");
    for (const ev of events) {
      if (ev.source === "fudan") {
        if (ev.color !== "teal") await db.put("events", { ...ev, color: "teal", updatedAt: Date.now() });
      } else if (ev.color === "teal") {
        // 个人任务不再和课表共用同一种颜色
        await db.put("events", { ...ev, color: "violet", updatedAt: Date.now() });
      }
    }
  } catch (e) {}
  await setSetting("courseColorV1", "1");
}

/* ---------------- 首次启动 ---------------- */
export async function seedIfNeeded() {
  // 复旦版不再写入示例日程；登录后由课表同步生成真实课程
  if (getSetting("seeded") !== "1") {
    await setSetting("seeded", "1");
    await setSetting("demoCleaned", "1");
    return;
  }
  // 老版本首次启动写入过示例日程：升级后按“标题 + 描述 + 开始时间”精确清理一次
  if (getSetting("demoCleaned") !== "1") {
    const demos = [
      ["项目周会", "同步本周里程碑进度，确认交付物与风险项。", "09:30"],
      ["完成季度汇报材料", "整理数据看板与关键结论，输出汇报初稿。", "14:00"],
      ["健身训练", "力量训练 45 分钟 + 拉伸。", "18:30"],
      ["设计评审会", "评审新版工作台交互方案，收集反馈。", "10:00"],
      ["整理客户反馈并输出改进清单", "汇总 12 条反馈，输出优先级与负责人建议。", "16:00"],
    ];
    try {
      const events = await db.all("events");
      for (const ev of events) {
        const hit = demos.some(([t, d, s]) => ev.title === t && ev.description === d && ev.start === s);
        if (hit) await db.del("events", ev.id);
      }
    } catch (e) {}
    await setSetting("demoCleaned", "1");
  }
}

/* ---------------- 备份 ---------------- */
export async function exportBackup() {
  const stores = Object.keys(STORES).filter((s) => s !== "files");
  const data = { app: "DanLume", version: 1, exportedAt: new Date().toISOString(), data: {} };
  for (const s of stores) data.data[s] = await db.all(s);
  return data;
}
export async function importBackup(payload) {
  if (!payload || !payload.data) throw new Error("备份文件格式不对");
  for (const [store, rows] of Object.entries(payload.data)) {
    if (!STORES[store] || store === "files" || !Array.isArray(rows)) continue;
    for (const row of rows) await db.put(store, row);
  }
  _settings.clear();
  await loadSettings();
}
export async function clearAllData() {
  for (const s of Object.keys(STORES)) await db.clear(s);
  _settings.clear();
}
