/* 启动：注册路由、主题、提醒、Service Worker */
import { loadSettings, seedIfNeeded, normalizeCourseColors, normalizeIosTheme, db, getSetting } from "./db.js";
import { applyTheme, bindThemeWatcher, toast } from "./ui.js";
import { registerRoutes, boot, navigate, setBadge, getRoute } from "./shell.js";
import { startReminders } from "./reminders.js";
import { startLoginGate } from "./login.js";
import { icon } from "./icons.js";

const ROUTES = {
  dashboard: { load: () => import("./views/dashboard.js"), tab: "dashboard" },
  calendar: { load: () => import("./views/calendar.js"), tab: "calendar" },
  mail: { load: () => import("./views/mail.js"), tab: "mail" },
  ai: { load: () => import("./views/ai.js"), tab: "ai" },
  more: { load: () => import("./views/more.js"), tab: "more" },
  memos: { load: () => import("./views/memos.js") },
  notices: { load: () => import("./views/notices.js") },
  homework: { load: () => import("./views/homework.js") },
  docs: { load: () => import("./views/docs.js") },
  lit: { load: () => import("./views/lit.js") },
  latex: { load: () => import("./views/latex.js") },
  ehall: { load: () => import("./views/ehall.js") },
  classroom: { load: () => import("./views/classroom.js") },
  focus: { load: () => import("./views/focus.js") },
  settings: { load: () => import("./views/settings.js"), tab: "more" },
  report: { load: () => import("./views/report.js") },
};

export async function updateBadges() {
  try {
    const [mails, notices] = await Promise.all([db.all("mails"), db.all("notices")]);
    const unreadMail = mails.filter((m) => m.folder === "inbox" && !m.read).length;
    const unreadNotice = notices.filter((n) => !n.read).length;
    setBadge("mail", unreadMail);
    setBadge("dashboard", unreadNotice);
  } catch (e) {}
}
window.__dlDataHook = updateBadges;

async function start() {
  try {
    await loadSettings();
    await normalizeIosTheme();
    applyTheme();
    bindThemeWatcher();
    await seedIfNeeded();
    await normalizeCourseColors();
    registerRoutes(ROUTES);
    boot(localStorage.getItem("dl:last-route") || "dashboard");
    startReminders();
    updateBadges();
    startLoginGate();
    window.addEventListener("danlume:data", () => updateBadges());
    window.addEventListener("hashchange", () => {
      const r = location.hash.replace(/^#\//, "").split("?")[0];
      if (r) localStorage.setItem("dl:last-route", r);
    });
  } catch (e) {
    console.error(e);
    document.getElementById("view").innerHTML =
      '<div class="card" style="margin-top:20px"><div class="card-title">启动失败</div>' +
      '<div class="small muted" style="margin-top:8px">' + String(e && e.message || e) + "</div></div>";
  } finally {
    const boot = document.getElementById("boot");
    if (boot) { boot.style.transition = "opacity .3s"; boot.style.opacity = "0"; setTimeout(() => boot.remove(), 320); }
  }
  // Service Worker（需要 https 或 localhost）
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  // 页面在后台时暂停滚动位置抖动
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) updateBadges();
  });
}

window.DL = { navigate, db, getSetting, toast, icon, updateBadges };
start();
