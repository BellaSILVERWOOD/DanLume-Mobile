/* eHall：校园服务入口 + 内嵌网页 */
import { getSetting } from "../db.js";
import { setHeader } from "../shell.js";
import { icon } from "../icons.js";
import { esc, toast, openSheet } from "../ui.js";
import { bridgeFetch, checkBridge, bridge } from "../api.js";
import { syncFudanAll, lastSyncText } from "../fudan.js";
import { showLoginGateAgain } from "../login.js";

let rootEl = null;
let status = null;

const SERVICES = [
  { icon: "card", name: "校园卡", desc: "余额与消费", url: "https://ecard.fudan.edu.cn" },
  { icon: "bus", name: "校车", desc: "班车时刻", url: "" },
  { icon: "dumbbell", name: "体育刷锻", desc: "锻炼记录", url: "" },
  { icon: "book-open", name: "图书馆", desc: "在馆人数 / 借阅", url: "https://www.library.fudan.edu.cn" },
  { icon: "calendar", name: "课表", desc: "本学期课程", url: "" },
  { icon: "chart", name: "成绩", desc: "成绩查询", url: "" },
  { icon: "school", name: "空教室", desc: "查空闲", url: "#/classroom" },
  { icon: "book", name: "eLearning", desc: "课程与作业", url: getSetting("elearningUrl", "https://elearning.fudan.edu.cn") },
];

export async function render(root) {
  rootEl = root;
  setHeader("eHall", "校园服务", [
    { icon: "external", title: "浏览器打开", onClick: () => window.open(getSetting("ehallUrl", "https://ehall.fudan.edu.cn"), "_blank", "noopener") },
    { icon: "refresh", title: "刷新", onClick: () => paint() },
  ]);
  status = await checkBridge();
  paint();
  return () => {};
}

function paint() {
  const base = getSetting("ehallUrl", "https://ehall.fudan.edu.cn");
  const logged = getSetting("fudanLoggedIn", "0") === "1";
  const name = getSetting("fudanName", "") || "未登录";
  const sid = getSetting("fudanId", "");
  const dept = getSetting("fudanDept", "");
  rootEl.innerHTML =
    '<div class="card tight" style="background:linear-gradient(135deg, color-mix(in srgb, var(--accent) 12%, var(--surface)), var(--surface) 78%)">' +
      '<div class="row"><span class="card-ico" style="background:rgba(11,61,145,.10);color:#0B3D91">' + icon("school") + '</span>' +
      '<span class="card-title">复旦统一身份认证</span><span class="spacer"></span>' +
      '<span class="badge ' + (logged ? "ok" : "warn") + '">' + (logged ? "已登录" : "未登录") + "</span></div>" +
      (logged
        ? '<div style="margin-top:10px"><div class="bold" style="font-size:17px">' + esc(name) + '</div>' +
          '<div class="small muted">' + esc(sid) + (dept ? " · " + esc(dept) : "") + "</div>" +
          '<div class="tiny faint" style="margin-top:3px">' + esc(lastSyncText()) + "</div></div>"
        : '<div class="small muted" style="margin-top:8px;line-height:1.6">在登录页完成一次复旦身份验证，之后会自动同步课表、eHall 与教务通知。</div>') +
      '<div class="row" style="gap:8px;margin-top:12px">' +
        (logged
          ? '<button class="btn small soft" id="eh-sync">' + icon("refresh") + "立即同步</button>" +
            '<button class="btn small ghost" id="eh-logout">退出登录</button>'
          : '<button class="btn small primary" id="eh-do-login">去登录</button>' +
            '<button class="btn small ghost" id="eh-login">打开 eHall</button>') +
      "</div>" +
      '<div class="tiny faint" style="margin-top:8px">' + esc(base) + "</div></div>" +

    '<div class="section-title"><span>常用服务</span><span class="spacer"></span><span class="tiny muted">长按可复制地址</span></div>' +
    '<div class="tool-grid">' + SERVICES.map((s) =>
      '<button class="tool-tile" data-svc="' + esc(s.name) + '" data-url="' + esc(s.url) + '">' +
        '<span class="tool-ico" style="color:var(--accent);background:color-mix(in srgb, var(--accent) 12%, transparent)">' + icon(s.icon) + "</span>" +
        '<span class="tool-body"><span class="tool-title">' + esc(s.name) + "</span>" +
        '<span class="tool-desc">' + esc(s.desc) + "</span></span></button>").join("") + "</div>" +

    '<div class="section-title"><span>eHall 网页</span><span class="spacer"></span><button id="eh-open">在浏览器打开</button></div>' +
    '<div class="card tight" style="padding:8px" id="eh-frame-box">' +
      '<div id="eh-frame-placeholder" class="empty" style="padding:28px 16px">' + icon("globe") +
        '<div class="empty-title">内嵌网页</div><div class="empty-sub">点一下加载 eHall 网页，部分校园网站不允许被内嵌。</div>' +
        '<button class="btn small soft" style="margin-top:12px" id="eh-load-frame">加载网页</button></div>' +
    "</div>" +
    '<div class="hint" style="margin-top:10px">很多校园网站禁止被内嵌（X-Frame-Options）。白屏时点右上角用系统浏览器打开，登录状态会保存在浏览器里。</div>' +
    '<div style="height:16px"></div>';

  rootEl.querySelectorAll("[data-svc]").forEach((b) => b.onclick = async () => {
    const url = b.dataset.url;
    if (url === "#/classroom") { location.hash = "#/classroom"; return; }
    if (!url) {
      toast("这个服务还没有固定地址，可以从 eHall 首页进入");
      window.open(getSetting("ehallUrl", "https://ehall.fudan.edu.cn"), "_blank", "noopener");
      return;
    }
    window.open(url, "_blank", "noopener");
  });
  const doLogin = rootEl.querySelector("#eh-do-login");
  if (doLogin) doLogin.onclick = () => showLoginGateAgain();
  const syncBtn = rootEl.querySelector("#eh-sync");
  if (syncBtn) syncBtn.onclick = async () => {
    syncBtn.disabled = true;
    toast("正在同步课表与通知…");
    try {
      const r = await syncFudanAll(() => {});
      const parts = [];
      if (r.timetable) parts.push(r.timetable.count + " 节课");
      if (r.notices) parts.push(r.notices.added + " 条新通知");
      toast(parts.length ? "已同步：" + parts.join(" · ") : "同步完成，没有新数据", r.errors.length ? "err" : "ok");
      if (r.errors.length) toast(r.errors.join("；"), "err");
      paint();
    } catch (e) { toast("同步失败：" + (e.message || e), "err"); }
    finally { syncBtn.disabled = false; }
  };
  const logoutBtn = rootEl.querySelector("#eh-logout");
  if (logoutBtn) logoutBtn.onclick = async () => {
    const { fudanLogout, clearProfile } = await import("../fudan.js");
    await fudanLogout(true);
    await clearProfile();
    toast("已退出复旦账号");
    location.reload();
  };
  const openLogin = rootEl.querySelector("#eh-login");
  if (openLogin) openLogin.onclick = () => {
    window.open(base, "_blank", "noopener");
    toast("已在新窗口打开 eHall");
  };
  rootEl.querySelector("#eh-open").onclick = () => window.open(base, "_blank", "noopener");
  rootEl.querySelector("#eh-load-frame").onclick = () => {
    const box = rootEl.querySelector("#eh-frame-box");
    box.innerHTML = '<iframe src="' + esc(base) + '" style="width:100%;height:56vh;border:0;border-radius:14px;background:var(--surface-2)" referrerpolicy="no-referrer"></iframe>' +
      '<div class="row" style="gap:8px;margin-top:8px"><button class="btn tiny ghost" id="eh-hide">收起</button>' +
      '<span class="tiny faint">白屏说明网站禁止内嵌，请用系统浏览器打开</span></div>';
    box.querySelector("#eh-hide").onclick = () => paint();
  };
  const sessionBtn = rootEl.querySelector("#eh-session");
  if (sessionBtn) sessionBtn.onclick = async () => {
    if (!bridge()) { toast("需要先启动本地服务", "err"); return; }
    try {
      const s = await bridgeFetch("/api/web/session", undefined, { method: "GET" });
      toast("已保存 " + s.cookies + " 个 Cookie，涉及 " + (s.hosts || []).length + " 个站点");
    } catch (e) { toast(e.message || "读取失败", "err"); }
  };
}
