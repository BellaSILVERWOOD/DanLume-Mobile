/* 提醒：轮询日程，弹应用内提醒 + 系统通知 */
import { db, getSetting } from "./db.js";
import { eventsOnDay, dateStr, timeToMin, fmtTime, addDays } from "./util.js";
import { icon } from "./icons.js";

const LS_KEY = "danlume:fired";
const fired = new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]"));
const snoozed = new Map();
let timer = 0;
let activeBanner = null;

function persist() {
  localStorage.setItem(LS_KEY, JSON.stringify(Array.from(fired).slice(-800)));
}
function prune(now) {
  const cutoff = dateStr(addDays(new Date(), -2));
  for (const key of Array.from(fired)) {
    const day = key.split("@")[1];
    if (day && day < cutoff) fired.delete(key);
  }
}

export function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [0, 0.18].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 0 ? 880 : 1174;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.16, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.2);
    });
    setTimeout(() => ctx.close && ctx.close(), 900);
  } catch (e) {}
}

export async function requestNotifyPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  try { return await Notification.requestPermission(); } catch (e) { return Notification.permission; }
}

function systemNotify(title, body) {
  if (getSetting("reminders", "1") !== "1") return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, icon: "icons/app-192.png", tag: "danlume-" + Date.now() });
    setTimeout(() => { try { n.close(); } catch (e) {} }, 12000);
  } catch (e) {}
}

export function showReminderBanner({ title, subtitle, kind, onDone, onSnooze }) {
  hideReminderBanner();
  const app = document.getElementById("app");
  const node = document.createElement("div");
  node.className = "reminder-banner";
  node.innerHTML =
    '<div class="rb-title">' + icon(kind === "depart" ? "map-pin" : "alarm") +
      "<span>" + escapeHtml(title) + "</span></div>" +
    '<div class="rb-time">' + escapeHtml(subtitle) + "</div>" +
    '<div class="rb-actions"><button class="btn small primary" data-act="done">标记完成</button>' +
    '<button class="btn small ghost" data-act="snooze">稍后 10 分钟</button>' +
    '<button class="icon-btn plain" data-act="close" style="width:32px;height:32px;margin-left:auto">' + icon("x") + "</button></div>";
  app.appendChild(node);
  activeBanner = node;
  node.querySelector('[data-act="close"]').onclick = () => hideReminderBanner();
  node.querySelector('[data-act="done"]').onclick = () => { hideReminderBanner(); onDone && onDone(); };
  node.querySelector('[data-act="snooze"]').onclick = () => { hideReminderBanner(); onSnooze && onSnooze(); };
  if (getSetting("reminderSound", "1") === "1") beep();
  systemNotify(title, subtitle);
  setTimeout(() => { if (activeBanner === node) hideReminderBanner(); }, 90000);
  return node;
}
export function hideReminderBanner() {
  if (activeBanner) { activeBanner.remove(); activeBanner = null; }
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function tick() {
  if (getSetting("reminders", "1") !== "1") return;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = dateStr(now);
  let events = [];
  try { events = await db.all("events"); } catch (e) { return; }
  const todays = eventsOnDay(events, today);
  const depEnabled = getSetting("departureRemind", "0") === "1";
  const depMinutes = Number(getSetting("departureMinutes", "20")) || 20;
  for (const ev of todays) {
    const startMin = timeToMin(ev.start || "09:00");
    if (ev.remind != null) {
      const trigger = startMin - Number(ev.remind);
      const key = "r:" + ev.id + "@" + ev.instanceDate;
      if (!fired.has(key) && nowMin >= trigger && nowMin - trigger <= 30) {
        const snoozedAt = snoozed.get(key);
        if (snoozedAt && Date.now() - snoozedAt < 10 * 60 * 1000) continue;
        fired.add(key); persist(); prune(now);
        showReminderBanner({
          title: ev.title,
          subtitle: fmtTime(ev.start) + (ev.end ? " – " + fmtTime(ev.end) : "") + (ev.location ? " · " + ev.location : "") + " · " + (Number(ev.remind) === 0 ? "现在开始" : "还有 " + ev.remind + " 分钟"),
          kind: "event",
          onDone: async () => {
            if (!ev.repeat) {
              const cur = await db.get("events", ev.id);
              if (cur) await db.put("events", { ...cur, done: 1, updatedAt: Date.now() });
              window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "events" } }));
            }
          },
          onSnooze: () => { snoozed.set(key, Date.now()); fired.delete(key); persist(); },
        });
        return;
      }
    }
    if (depEnabled && ev.location) {
      const trigger = startMin - depMinutes;
      const key = "d:" + ev.id + "@" + ev.instanceDate;
      if (!fired.has(key) && nowMin >= trigger && nowMin - trigger <= 15) {
        fired.add(key); persist();
        showReminderBanner({
          title: "该出发了：" + ev.title,
          subtitle: fmtTime(ev.start) + " 开始 · " + ev.location + " · 预计步行 " + depMinutes + " 分钟",
          kind: "depart",
          onDone: () => {},
          onSnooze: () => { fired.delete(key); persist(); },
        });
        return;
      }
    }
  }
}

export function startReminders() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => { tick().catch(() => {}); }, 20000);
  setTimeout(() => { tick().catch(() => {}); }, 2500);
}
