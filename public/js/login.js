/* 复旦身份验证门：自定义 UI → 学校 ID 系统 → 保存登录态 */
import { icon } from "./icons.js";
import { esc, toast } from "./ui.js";
import {
  fudanStatus, fudanLogin, fudanAutologin, saveProfile, syncFudanAll, isFudanLoggedIn,
} from "./fudan.js";
import { getSetting, setSetting } from "./db.js";
import { refreshCurrent } from "./shell.js";

let gate = null;
let resolveFn = null;
let skipAllowed = false;

export function isGateOpen() { return !!gate; }

export async function startLoginGate() {
  if (gate) return;
  await new Promise((resolve) => {
    resolveFn = resolve;
    openGate();
    begin();
  });
}

function openGate() {
  gate = document.createElement("div");
  gate.id = "login-gate";
  gate.innerHTML =
    '<div class="lg-orb lg-orb-a"></div><div class="lg-orb lg-orb-b"></div>' +
    '<div class="lg-content">' +
      '<div class="lg-hero">' +
        '<img src="icons/app-192.png" class="lg-logo" alt="DanLume" />' +
        '<div class="lg-brand"><span class="lg-dot"></span>复旦大学 · 统一身份认证</div>' +
        '<h1>日月光华<br>旦复旦兮</h1>' +
        '<p class="lg-sub">登录后自动同步你的课表、eHall 与教务通知</p>' +
      "</div>" +
      '<div class="lg-card">' +
        '<div class="lg-card-title">' + icon("lock") + "登录复旦账号</div>" +
        '<div class="field lg-field"><label>学号 / 工号</label>' +
          '<div class="lg-input">' + icon("user") + '<input id="lg-user" autocomplete="username" inputmode="text" placeholder="例如 22300130000" /></div></div>' +
        '<div class="field lg-field"><label>密码</label>' +
          '<div class="lg-input">' + icon("lock") + '<input id="lg-pass" type="password" autocomplete="current-password" placeholder="统一身份认证密码" />' +
          '<button class="lg-eye" id="lg-eye" type="button" aria-label="显示密码">显示</button></div></div>' +
        '<div class="lg-row"><label class="lg-toggle"><input type="checkbox" id="lg-remember" checked><span></span>记住我</label>' +
          '<span class="lg-hint">密码经系统密钥加密后保存在本机</span></div>' +
        '<div class="lg-error" id="lg-error" hidden></div>' +
        '<button class="lg-btn" id="lg-login" type="button"><span>登录并同步</span></button>' +
        '<div class="lg-status" id="lg-status" hidden><span class="lg-spinner"></span><span id="lg-status-text">正在验证身份…</span></div>' +
        '<button class="lg-skip" id="lg-skip" type="button" hidden>先离线使用（不同步）</button>' +
        '<div class="lg-note">仅用于向 <b>id.fudan.edu.cn</b> 发起认证；不会经过任何第三方服务器。' +
          (isApk() ? "登录信息保存在本机。" : "") + "</div>" +
      "</div>" +
      '<div class="lg-foot">DanLume 手机版 · 仅面向复旦大学<br><span>如果学校要求验证码或二次验证，请先在浏览器登录一次后再回来。</span></div>' +
    "</div>";
  document.body.appendChild(gate);
  requestAnimationFrame(() => gate.classList.add("show"));

  const user = gate.querySelector("#lg-user");
  const pass = gate.querySelector("#lg-pass");
  const err = gate.querySelector("#lg-error");
  const status = gate.querySelector("#lg-status");
  const statusText = gate.querySelector("#lg-status-text");
  const loginBtn = gate.querySelector("#lg-login");
  const skipBtn = gate.querySelector("#lg-skip");
  const eye = gate.querySelector("#lg-eye");

  user.value = getSetting("fudanId", "");
  eye.onclick = () => {
    const show = pass.type === "password";
    pass.type = show ? "text" : "password";
    eye.textContent = show ? "隐藏" : "显示";
  };
  loginBtn.onclick = () => doLogin(user.value.trim(), pass.value, gate.querySelector("#lg-remember").checked, { err, status, statusText, loginBtn, pass });
  pass.addEventListener("keydown", (e) => { if (e.key === "Enter") loginBtn.click(); });
  user.addEventListener("keydown", (e) => { if (e.key === "Enter") pass.focus(); });
  skipBtn.onclick = () => finish({ skipped: true });
}

function isApk() { return /DanLumeApp/.test(navigator.userAgent); }

async function begin() {
  const err = gate.querySelector("#lg-error");
  const status = gate.querySelector("#lg-status");
  const statusText = gate.querySelector("#lg-status-text");
  const loginBtn = gate.querySelector("#lg-login");
  status.hidden = false;
  statusText.textContent = "正在检查登录状态…";
  loginBtn.disabled = true;
  try {
    const s = await fudanStatus();
    status.hidden = true;
    loginBtn.disabled = false;
    if (s && s.loggedIn) {
      await saveProfile(s.profile);
      finish({ profile: s.profile });
      maybeBackgroundSync();
      return;
    }
    if (s && s.hasSaved) {
      status.hidden = false;
      statusText.textContent = "正在恢复上次的登录…";
      gate.querySelector("#lg-login").disabled = true;
      const r = await fudanAutologin();
      status.hidden = true;
      gate.querySelector("#lg-login").disabled = false;
      if (r && r.ok) {
        await saveProfile(r.profile);
        finish({ profile: r.profile });
        maybeBackgroundSync();
        return;
      }
      if (r && r.error && r.error !== "还没有保存登录信息") {
        showError(r.error);
      }
      if (s.savedUsername) gate.querySelector("#lg-user").value = s.savedUsername;
    }
  } catch (e) {
    showError("连接本机认证服务失败：" + (e.message || e));
    gate.querySelector("#lg-login").disabled = true;
    gate.querySelector("#lg-skip").hidden = false;
    gate.querySelector("#lg-skip").textContent = "离线使用（不验证身份）";
  }
}

function showError(message) {
  const err = gate.querySelector("#lg-error");
  err.hidden = false;
  err.textContent = message;
  err.classList.remove("shake");
  void err.offsetWidth;
  err.classList.add("shake");
}

async function doLogin(username, password, remember, ui) {
  if (!username) { showError("请填写学号或工号"); return; }
  if (!password) { showError("请填写密码"); return; }
  ui.err.hidden = true;
  ui.loginBtn.disabled = true;
  ui.loginBtn.querySelector("span").textContent = "正在连接学校…";
  ui.pass.disabled = true;
  try {
    const r = await fudanLogin(username, password, remember);
    if (!r || !r.ok) {
      showError((r && r.error) || "登录失败，请稍后重试");
      ui.loginBtn.disabled = false;
      ui.loginBtn.querySelector("span").textContent = "登录并同步";
      ui.pass.disabled = false;
      return;
    }
    await saveProfile(r.profile);
    await finishWithSync(r.profile);
  } catch (e) {
    showError("登录失败：" + (e.message || e));
    ui.loginBtn.disabled = false;
    ui.loginBtn.querySelector("span").textContent = "登录并同步";
    ui.pass.disabled = false;
  }
}

async function finishWithSync(profile) {
  const card = gate.querySelector(".lg-card");
  const hero = gate.querySelector(".lg-hero");
  card.querySelectorAll("input,button").forEach((n) => { n.disabled = true; });
  const status = gate.querySelector("#lg-status");
  const statusText = gate.querySelector("#lg-status-text");
  const loginBtn = gate.querySelector("#lg-login");
  loginBtn.hidden = true;
  status.hidden = false;
  statusText.textContent = "正在同步课表…";
  hero.querySelector("h1").innerHTML = "欢迎回来<br>" + esc(profile.name || profile.id || "");
  try {
    const result = await syncFudanAll((step) => { statusText.textContent = step; });
    const parts = [];
    if (result.timetable) parts.push(result.timetable.count + " 节课");
    if (result.notices) parts.push(result.notices.added + " 条新通知");
    if (result.errors.length) {
      toast("登录成功，部分同步失败：" + result.errors.join("；"), "err");
    } else {
      toast("已同步 " + (parts.join(" · ") || "课表与通知"), "ok");
    }
  } catch (e) {
    toast("登录成功，但同步失败：" + (e.message || e), "err");
  }
  setTimeout(() => finish({ profile }), 350);
}

function finish(result) {
  if (!gate) return;
  gate.classList.remove("show");
  gate.style.transition = "opacity .3s";
  gate.style.opacity = "0";
  const node = gate;
  gate = null;
  setTimeout(() => node.remove(), 320);
  if (resolveFn) { resolveFn(result); resolveFn = null; }
  refreshCurrent();
}

async function maybeBackgroundSync() {
  const last = Number(getSetting("fudanSyncAt", "0")) || 0;
  if (Date.now() - last < 6 * 60 * 60 * 1000) return;
  try {
    const result = await syncFudanAll(() => {});
    if (!result.errors.length) {
      window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "fudan" } }));
    }
  } catch (e) {}
}

/** 设置页里“重新登录”用 */
export async function showLoginGateAgain() {
  if (gate) return;
  await setSetting("fudanLoggedIn", "0");
  startLoginGate();
}
