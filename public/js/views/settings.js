/* 设置：外观、提醒、课表、AI、邮箱、服务、数据 */
import { db, getSetting, setSetting, exportBackup, importBackup, allSettings } from "../db.js";
import { setHeader, navigate, refreshCurrent } from "../shell.js";
import { icon } from "../icons.js";
import { esc, toast, openSheet, confirmDialog, promptDialog, actionSheet, qs, el, applyTheme, isDark, ACCENTS, BG_TINTS, FONTS } from "../ui.js";
import { readFile, downloadBlob, dateStr } from "../util.js";
import { checkBridge, bridgeFetch, bridge } from "../api.js";
import { listModels } from "../ai.js";
import { requestNotifyPermission } from "../reminders.js";
import { showLoginGateAgain } from "../login.js";
import { syncTimetable, syncNotices, syncFudanAll, fudanLogout, clearProfile, lastSyncText } from "../fudan.js";

let rootEl = null;

export async function render(root, ctx) {
  rootEl = root;
  setHeader("设置", "", []);
  paint();
  const card = ctx && ctx.params && ctx.params.card;
  if (card) setTimeout(() => openCard(card), 120);
  return () => {};
}

const CARDS = [
  { id: "fudan", icon: "school", title: "复旦账号", sub: () => getSetting("fudanLoggedIn", "0") === "1" ? (getSetting("fudanName", "") || getSetting("fudanId", "")) : "未登录", color: "#0B3D91" },
  { id: "profile", icon: "user", title: "账户与资料", sub: () => getSetting("userName", "") || "未填写", color: "#3B6EA5" },
  { id: "appearance", icon: "palette", title: "外观", sub: () => "主题 · 强调色 · 字体", color: "#AF52DE" },
  { id: "reminders", icon: "bell", title: "提醒与通知", sub: () => getSetting("reminders", "1") === "1" ? "已开启" : "已关闭", color: "#FF9500" },
  { id: "timetable", icon: "calendar", title: "课表与周次", sub: () => getSetting("termStart", "") ? "开学 " + getSetting("termStart") : "未设置开学日期", color: "#30B0C7" },
  { id: "ai", icon: "sparkles", title: "AI 设置", sub: () => getSetting("apiModel", "未配置") || "未配置", color: "#2F7A5F" },
  { id: "mail", icon: "mail", title: "邮箱", sub: () => getSetting("reportTo", "") || "IMAP / SMTP", color: "#007AFF" },
  { id: "campus", icon: "school", title: "教务与 eHall", sub: () => "通知抓取地址", color: "#2F8F8A" },
  { id: "weather", icon: "cloud", title: "天气", sub: () => getSetting("weatherCity", "上海"), color: "#4F9BD9" },
  { id: "bridge", icon: "server", title: "本地服务", sub: () => bridge() || "未配置", color: "#5A5F73" },
  { id: "data", icon: "database", title: "数据与备份", sub: () => "导出 / 导入 / 清空", color: "#C2703E" },
  { id: "privacy", icon: "lock", title: "隐私", sub: () => "数据只保存在本机", color: "#6B7A3A" },
  { id: "about", icon: "info", title: "关于", sub: () => "DanLume 手机版 1.3.2", color: "#8A8F98" },
];

const GROUPS = [
  { title: "账户", ids: ["fudan"] },
  { title: "通用", ids: ["appearance", "reminders", "timetable"] },
  { title: "AI 与邮箱", ids: ["ai", "mail"] },
  { title: "校园", ids: ["campus", "weather"] },
  { title: "高级", ids: ["bridge", "data", "privacy", "about"] },
];

function cardRow(c) {
  return '<div class="list-item" data-card="' + c.id + '">' +
    '<div class="li-ico" style="background:' + c.color + ';color:#fff">' + icon(c.icon) + "</div>" +
    '<div class="li-body"><div class="li-title">' + c.title + "</div>" +
    '<div class="li-sub">' + esc(c.sub()) + "</div></div>" +
    '<div class="li-trail">' + icon("chevron-right") + "</div></div>";
}

function paint() {
  const name = getSetting("userName", "") || "还没有填写名字";
  const school = getSetting("userSchool", "") || "本机账户";
  const profile = '<div class="list-item" data-card="profile">' +
    '<div class="avatar" style="width:44px;height:44px;font-size:18px;background:var(--accent);color:#fff">' + esc(name.slice(0, 1)) + "</div>" +
    '<div class="li-body"><div class="li-title" style="font-weight:600">' + esc(name) + "</div>" +
    '<div class="li-sub">' + esc(school) + "</div></div>" +
    '<div class="li-trail">' + icon("chevron-right") + "</div></div>";
  const byId = Object.fromEntries(CARDS.map((c) => [c.id, c]));
  rootEl.innerHTML = GROUPS.map((g) => {
    const rows = g.ids.map((id) => id === "fudan" ? profile + cardRow(byId.fudan) : cardRow(byId[id])).join("");
    return '<div class="section-title">' + g.title + '</div><div class="list">' + rows + "</div>";
  }).join("") +
    '<div class="hint" style="text-align:center;margin:24px 0 6px">DanLume 手机版 1.2.3</div>' +
    '<div style="height:18px"></div>';
  rootEl.querySelectorAll("[data-card]").forEach((n) => n.onclick = () => openCard(n.dataset.card));
}

function openCard(id) {
  if (id === "fudan") openFudanAccount();
  else if (id === "profile") openProfile();
  else if (id === "appearance") openAppearance();
  else if (id === "reminders") openReminders();
  else if (id === "timetable") openTimetable();
  else if (id === "ai") openAI();
  else if (id === "mail") openMailSettings();
  else if (id === "campus") openCampus();
  else if (id === "weather") openWeather();
  else if (id === "bridge") openBridge();
  else if (id === "data") openData();
  else if (id === "privacy") openPrivacy();
  else if (id === "about") openAbout();
}

function formSheet(title, fields, { hint = "", onSaveExtra = null, extraHtml = "" } = {}) {
  openSheet({
    title,
    full: true,
    footer: true,
    build(body, api) {
      body.innerHTML = fields.map((f) => {
        if (f.type === "switch") {
          return '<div class="toggle-row"><div class="tr-body"><div class="tr-title">' + esc(f.label) + '</div><div class="tr-sub">' + (f.hint || "") + '</div></div>' +
            '<label class="switch"><input type="checkbox" data-f="' + f.key + '" ' + (String(getSetting(f.key, f.def || "")) === "1" ? "checked" : "") + '><span></span></label></div>';
        }
        if (f.type === "select") {
          return '<div class="field"><label>' + esc(f.label) + "</label><select class=\"input\" data-f=\"" + f.key + "\">" +
            f.options.map((o) => '<option value="' + esc(o.value) + '" ' + (String(getSetting(f.key, f.def || "")) === String(o.value) ? "selected" : "") + ">" + esc(o.label) + "</option>").join("") + "</select>" +
            (f.hint ? '<div class="hint">' + f.hint + "</div>" : "") + "</div>";
        }
        if (f.type === "textarea") {
          return '<div class="field"><label>' + esc(f.label) + "</label><textarea class=\"textarea\" data-f=\"" + f.key + "\" style=\"min-height:110px\" placeholder=\"" + esc(f.placeholder || "") + "\">" + esc(getSetting(f.key, f.def || "")) + "</textarea>" +
            (f.hint ? '<div class="hint">' + f.hint + "</div>" : "") + "</div>";
        }
        return '<div class="field"><label>' + esc(f.label) + "</label><input class=\"input\" data-f=\"" + f.key + "\" type=\"" + (f.type || "text") + "\" value=\"" + esc(getSetting(f.key, f.def || "")) + "\" placeholder=\"" + esc(f.placeholder || "") + "\" />" +
          (f.hint ? '<div class="hint">' + f.hint + "</div>" : "") + "</div>";
      }).join("") + extraHtml + (hint ? '<div class="hint">' + hint + "</div>" : "");
      const foot = api.foot;
      foot.innerHTML = "";
      const save = el('<button class="btn primary">保存</button>');
      save.onclick = async () => {
        const values = {};
        body.querySelectorAll("[data-f]").forEach((n) => {
          values[n.dataset.f] = n.type === "checkbox" ? (n.checked ? "1" : "0") : n.value;
        });
        for (const [k, v] of Object.entries(values)) await setSetting(k, v);
        if (onSaveExtra) await onSaveExtra(values, body);
        toast("已保存", "ok");
        applyTheme();
        api.close();
        paint();
        if (typeof window.__afterSettings === "function") window.__afterSettings();
      };
      foot.appendChild(save);
    },
  });
}

function openProfile() {
  formSheet("账户与资料", [
    { key: "userName", label: "你的名字", placeholder: "例如：张三" },
    { key: "userSchool", label: "学校 / 单位", placeholder: "例如：复旦大学" },
  ]);
}

async function openAppearance() {
  openSheet({
    title: "外观",
    full: true,
    build(body, api) {
      const paintBody = () => {
        body.innerHTML =
          '<div class="field"><label>主题</label><div class="segmented" id="ap-theme">' +
            [["light", "浅色"], ["dark", "深色"], ["auto", "跟随系统"]].map(([v, l]) =>
              '<button data-v="' + v + '" class="' + (getSetting("theme", "light") === v ? "active" : "") + '">' + l + "</button>").join("") +
          "</div></div>" +
          '<div class="field"><label>强调色</label><div class="chips" id="ap-accent">' +
            ACCENTS.map((a) => '<button class="color-dot ' + (getSetting("accent").toLowerCase() === a.value.toLowerCase() ? "on" : "") + '" style="--c:' + a.value + '" data-c="' + a.value + '" title="' + a.label + '"></button>').join("") +
            '<button class="chip" id="ap-custom">自定义</button></div></div>' +
          '<div class="field"><label>背景色调</label><div class="chips" id="ap-bg">' +
            BG_TINTS.map((b) => '<button class="chip ' + (getSetting("bg", "linen") === b.value ? "active" : "") + '" data-b="' + b.value + '">' + b.label + "</button>").join("") +
          "</div></div>" +
          '<div class="field"><label>字体</label><div class="chips" id="ap-font">' +
            FONTS.map((f) => '<button class="chip ' + (getSetting("font", "system") === f.value ? "active" : "") + '" data-f="' + f.value + '">' + f.label + "</button>").join("") +
          "</div></div>" +
          '<div class="card flat"><div class="toggle-row"><div class="tr-body"><div class="tr-title">磨砂玻璃</div><div class="tr-sub">顶栏与底栏的半透明模糊</div></div>' +
            '<label class="switch"><input type="checkbox" id="ap-glass" ' + (getSetting("glass", "1") === "1" ? "checked" : "") + '><span></span></label></div></div>' +
          '<div class="hint">改动会立即生效并自动保存。</div>';
        body.querySelectorAll("#ap-theme button").forEach((b) => b.onclick = async () => {
          await setSetting("theme", b.dataset.v); applyTheme(); paintBody();
        });
        body.querySelectorAll("#ap-accent .color-dot").forEach((b) => b.onclick = async () => {
          await setSetting("accent", b.dataset.c); applyTheme(); paintBody();
        });
        body.querySelector("#ap-custom").onclick = async () => {
          const v = await promptDialog({ title: "自定义强调色", label: "十六进制颜色", value: getSetting("accent") });
          if (v && /^#[0-9a-f]{6}$/i.test(v.trim())) { await setSetting("accent", v.trim()); applyTheme(); paintBody(); }
        };
        body.querySelectorAll("#ap-bg button").forEach((b) => b.onclick = async () => {
          await setSetting("bg", b.dataset.b); applyTheme(); paintBody();
        });
        body.querySelectorAll("#ap-font button").forEach((b) => b.onclick = async () => {
          await setSetting("font", b.dataset.f); applyTheme(); paintBody();
        });
        body.querySelector("#ap-glass").onchange = async (e) => {
          await setSetting("glass", e.target.checked ? "1" : "0"); applyTheme(); paintBody();
        };
      };
      paintBody();
      if (api.foot) api.foot.style.display = "none";
      api.head.querySelector(".sheet-title").textContent = "外观";
    },
  });
}

function openFudanAccount() {
  openSheet({
    title: "复旦账号",
    full: true,
    build(body, api) {
      const paintBody = () => {
        const logged = getSetting("fudanLoggedIn", "0") === "1";
        const name = getSetting("fudanName", "") || "未登录";
        const sid = getSetting("fudanId", "");
        const dept = getSetting("fudanDept", "");
        const level = getSetting("fudanLevel", "undergraduate");
        if (!logged) {
          body.innerHTML =
            '<div class="card tint" style="background:linear-gradient(135deg,rgba(11,61,145,.10),var(--surface))">' +
              '<div class="row"><span class="card-ico" style="color:#0B3D91;background:rgba(11,61,145,.10)">' + icon("school") + "</span>" +
              '<span class="card-title">还没有登录复旦账号</span></div>' +
              '<div class="small muted" style="margin-top:8px;line-height:1.6">登录后会自动同步本学期课表、教务通知与 eHall 账号信息；下次打开不需要重复登录。</div>' +
              '<button class="btn primary block" style="margin-top:14px" id="fd-login">去登录</button></div>' +
            '<div class="hint">账号密码由学校 ID 系统校验，本机只保存加密后的凭据。</div>';
          body.querySelector("#fd-login").onclick = () => { api.close(); showLoginGateAgain(); };
          return;
        }
        body.innerHTML =
          '<div class="card" style="background:linear-gradient(135deg,#0B2D5B,#174C8A);color:#fff;border:0">' +
            '<div class="row" style="gap:12px"><div class="avatar" style="width:46px;height:46px;background:rgba(255,255,255,.16);color:#fff;font-size:17px">' + esc((name || "复").slice(0, 1)) + "</div>" +
              '<div><div style="font-size:18px;font-weight:700">' + esc(name) + '</div><div class="small" style="color:rgba(255,255,255,.7)">' + esc(sid) + (dept ? " · " + esc(dept) : "") + "</div></div>" +
              '<span class="spacer"></span><span class="badge" style="background:rgba(255,255,255,.18);color:#fff">已登录</span></div>' +
            '<div class="tiny" style="color:rgba(255,255,255,.6);margin-top:12px">' + esc(lastSyncText()) + (getSetting("fudanSemester", "") ? " · " + esc(getSetting("fudanSemester", "")) : "") + "</div>" +
          "</div>" +
          '<div class="grid-3" style="gap:8px">' +
            '<button class="btn small soft" id="fd-timetable">' + icon("calendar") + "课表</button>" +
            '<button class="btn small soft" id="fd-notices">' + icon("bell") + "通知</button>" +
            '<button class="btn small soft" id="fd-all">' + icon("refresh") + "全部</button>" +
          "</div>" +
          '<div class="field"><label>学历阶段</label><div class="segmented" id="fd-level">' +
            '<button data-v="undergraduate" class="' + (level === "undergraduate" ? "active" : "") + '">本科</button>' +
            '<button data-v="postgraduate" class="' + (level === "postgraduate" ? "active" : "") + '">研究生</button>' +
          "</div></div>" +
          '<div class="card flat tight"><div class="small muted">课表同步会替换上一次自动同步的课程日程，手动创建的日程不受影响。开学日期与总周数会一起更新。</div></div>' +
          '<button class="btn ghost block" id="fd-switch">切换账号 / 重新登录</button>' +
          '<button class="btn ghost block" id="fd-out" style="color:var(--danger)">退出复旦账号</button>';
        body.querySelector("#fd-level").querySelectorAll("button").forEach((b) => b.onclick = async () => {
          await setSetting("fudanLevel", b.dataset.v);
          paintBody();
        });
        const run = async (fn, label) => {
          toast("正在" + label + "…");
          try {
            const r = await fn();
            if (label === "同步课表") toast("已同步 " + r.count + " 节课程", "ok");
            else if (label === "抓取通知") toast(r.added ? "新增 " + r.added + " 条通知" : "没有新通知", r.added ? "ok" : "");
            else {
              const parts = [];
              if (r.timetable) parts.push(r.timetable.count + " 节课");
              if (r.notices) parts.push(r.notices.added + " 条新通知");
              toast(parts.length ? "已同步：" + parts.join(" · ") : "同步完成", r.errors.length ? "err" : "ok");
              if (r.errors.length) toast(r.errors.join("；"), "err");
            }
            paintBody();
            window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "fudan" } }));
          } catch (e) {
            toast(label + "失败：" + (e.message || e), "err");
          }
        };
        body.querySelector("#fd-timetable").onclick = () => run(() => syncTimetable(), "同步课表");
        body.querySelector("#fd-notices").onclick = () => run(() => syncNotices(), "抓取通知");
        body.querySelector("#fd-all").onclick = () => run(() => syncFudanAll(() => {}), "全部同步");
        body.querySelector("#fd-switch").onclick = async () => {
          await fudanLogout(true);
          await clearProfile();
          api.close();
          showLoginGateAgain();
        };
        body.querySelector("#fd-out").onclick = async () => {
          const ok = await confirmDialog({ title: "退出复旦账号", message: "退出后需要重新验证身份，本地日程与备忘不会删除。", ok: "退出", danger: true });
          if (!ok) return;
          await fudanLogout(true);
          await clearProfile();
          api.close();
          location.reload();
        };
      };
      paintBody();
    },
  });
}

function openReminders() {
  openSheet({
    title: "提醒与通知",
    full: true,
    build(body, api) {
      const paintBody = () => {
        body.innerHTML =
          '<div class="card flat">' +
            '<div class="toggle-row"><div class="tr-body"><div class="tr-title">日程提醒</div><div class="tr-sub">按日程里的提前量弹出提醒</div></div>' +
              '<label class="switch"><input type="checkbox" id="rm-on" ' + (getSetting("reminders", "1") === "1" ? "checked" : "") + '><span></span></label></div>' +
            '<div class="divider"></div>' +
            '<div class="toggle-row"><div class="tr-body"><div class="tr-title">提示音</div><div class="tr-sub">提醒时响两声</div></div>' +
              '<label class="switch"><input type="checkbox" id="rm-sound" ' + (getSetting("reminderSound", "1") === "1" ? "checked" : "") + '><span></span></label></div>' +
            '<div class="divider"></div>' +
            '<div class="toggle-row"><div class="tr-body"><div class="tr-title">出发提醒</div><div class="tr-sub">有地点的日程提前提醒出门</div></div>' +
              '<label class="switch"><input type="checkbox" id="rm-dep" ' + (getSetting("departureRemind", "0") === "1" ? "checked" : "") + '><span></span></label></div>' +
          "</div>" +
          '<div class="field"><label>出发提前量（分钟）</label><input class="input" id="rm-depmin" type="number" value="' + esc(getSetting("departureMinutes", "20")) + '" /></div>' +
          '<div class="card flat"><div class="tr-body"><div class="tr-title">系统通知</div><div class="tr-sub" id="rm-perm">' +
            (!("Notification" in window) ? "当前浏览器不支持" : Notification.permission === "granted" ? "已允许，切到后台也能收到" : "未允许，只在应用内提醒") + "</div></div>" +
            '<button class="btn small soft" id="rm-perm-btn">开启系统通知</button></div>' +
          '<div class="hint">提醒靠页面里的定时器检查：应用在后台时，手机浏览器可能会暂停它。系统通知需要浏览器授权。</div>';
        body.querySelector("#rm-on").onchange = async (e) => { await setSetting("reminders", e.target.checked ? "1" : "0"); };
        body.querySelector("#rm-sound").onchange = async (e) => { await setSetting("reminderSound", e.target.checked ? "1" : "0"); };
        body.querySelector("#rm-dep").onchange = async (e) => { await setSetting("departureRemind", e.target.checked ? "1" : "0"); };
        body.querySelector("#rm-depmin").onchange = async (e) => { await setSetting("departureMinutes", e.target.value); };
        body.querySelector("#rm-perm-btn").onclick = async () => {
          const r = await requestNotifyPermission();
          toast(r === "granted" ? "系统通知已开启" : "未获授权，仍可在应用内看到提醒", r === "granted" ? "ok" : "");
          paintBody();
        };
      };
      paintBody();
    },
  });
}

function openTimetable() {
  formSheet("课表与周次", [
    { key: "termStart", label: "开学第一周的周一", type: "date", hint: "用于计算「第几教学周」" },
    { key: "totalWeeks", label: "学期总周数", type: "number", def: "18" },
  ]);
}

function openAI() {
  openSheet({
    title: "AI 设置",
    full: true,
    footer: true,
    build(body, api) {
      body.innerHTML =
        '<div class="field"><label>服务地址</label><input class="input" id="ai-base" value="' + esc(getSetting("apiBase")) + '" placeholder="https://…/v1" /></div>' +
        '<div class="field"><label>访问密钥</label><input class="input" id="ai-key" type="password" value="' + esc(getSetting("apiKey")) + '" placeholder="粘贴你自己的密钥" /></div>' +
        '<div class="field"><label>模型</label><input class="input" id="ai-model" value="' + esc(getSetting("apiModel")) + '" placeholder="模型名" /></div>' +
        '<div class="field"><label>思考强度</label><select class="input" id="ai-effort">' +
          [["off", "关闭"], ["low", "快速 low"], ["high", "标准 high"], ["max", "深度 max"]].map(([v, l]) =>
            '<option value="' + v + '" ' + (getSetting("apiEffort", "high") === v ? "selected" : "") + ">" + l + "</option>").join("") +
        "</select></div>" +
        '<div class="field"><label>系统提示词</label><textarea class="textarea" id="ai-prompt" style="min-height:120px">' + esc(getSetting("systemPrompt")) + "</textarea></div>" +
        '<div class="field"><label>周报场景提示词</label><textarea class="textarea" id="ai-weekly" style="min-height:90px">' + esc(getSetting("sceneWeekly")) + "</textarea></div>" +
        '<div class="row" style="gap:8px"><button class="btn small ghost" id="ai-test">测试连接</button><span class="tiny faint" id="ai-test-out"></span></div>' +
        '<div class="hint">应用不内置任何服务地址或密钥，请填写你自己的 OpenAI 兼容服务。</div>';
      const foot = api.foot;
      foot.innerHTML = "";
      const save = el('<button class="btn primary">保存</button>');
      save.onclick = async () => {
        await setSetting("apiBase", body.querySelector("#ai-base").value.trim());
        await setSetting("apiKey", body.querySelector("#ai-key").value.trim());
        await setSetting("apiModel", body.querySelector("#ai-model").value.trim());
        await setSetting("apiEffort", body.querySelector("#ai-effort").value);
        await setSetting("systemPrompt", body.querySelector("#ai-prompt").value.trim());
        await setSetting("sceneWeekly", body.querySelector("#ai-weekly").value.trim());
        toast("已保存", "ok"); api.close();
        if (location.hash.includes("/ai")) refreshCurrent();
      };
      foot.appendChild(save);
      body.querySelector("#ai-test").onclick = async () => {
        const out = body.querySelector("#ai-test-out");
        out.textContent = "测试中…";
        await setSetting("apiBase", body.querySelector("#ai-base").value.trim());
        await setSetting("apiKey", body.querySelector("#ai-key").value.trim());
        await setSetting("apiModel", body.querySelector("#ai-model").value.trim());
        try {
          const models = await listModels();
          out.textContent = "连接正常，可用模型：" + models.slice(0, 4).join(", ");
        } catch (e) {
          out.textContent = e.message || String(e);
        }
      };
    },
  });
}

function openMailSettings() {
  openSheet({
    title: "邮箱",
    full: true,
    footer: true,
    build(body, api) {
      body.innerHTML =
        '<div class="card flat"><div class="tr-body"><div class="tr-title">收件箱账户</div>' +
        '<div class="tr-sub">APK 直接在本机收发邮件，账户用 Android Keystore 加密；网页版才需要电脑服务。</div></div>' +
        '<button class="btn small soft" style="margin-top:10px" id="ms-open">管理邮箱账户</button></div>' +
        '<div class="section-title"><span>发件默认</span></div>' +
        '<div class="field"><label>汇报邮件默认收件人</label><input class="input" id="ms-to" value="' + esc(getSetting("reportTo", "")) + '" placeholder="manager@example.com" /></div>' +
        '<div class="hint">在「邮箱 → 管理」里添加账户。QQ / 163 / 126 用授权码，Gmail 用应用专用密码。</div>';
      const foot = api.foot;
      foot.innerHTML = "";
      const save = el('<button class="btn primary">保存</button>');
      save.onclick = async () => {
        await setSetting("reportTo", body.querySelector("#ms-to").value.trim());
        toast("已保存", "ok"); api.close();
      };
      foot.appendChild(save);
      body.querySelector("#ms-open").onclick = () => { api.close(); navigate("mail"); };
    },
  });
}

function openCampus() {
  formSheet("教务与 eHall", [
    { key: "ehallUrl", label: "eHall 地址", def: "https://ehall.fudan.edu.cn" },
    { key: "elearningUrl", label: "eLearning 地址", def: "https://elearning.fudan.edu.cn" },
    { key: "classroomUrl", label: "空教室查询地址", placeholder: "可选" },
    { key: "ehallCard_balance", label: "仪表板 · 校园卡地址", placeholder: "在 eHall 打开校园卡后复制地址栏" },
    { key: "ehallCard_bus", label: "仪表板 · 校车地址", placeholder: "可选" },
    { key: "ehallCard_sport", label: "仪表板 · 体育刷锻地址", placeholder: "可选" },
    { key: "ehallCard_library", label: "仪表板 · 图书馆地址", placeholder: "可选" },
  ], { hint: "「通知 → 抓取」会从页面里收集通知链接；仪表板的四张卡会按这里填的地址同步数据（需要登录态时先在系统浏览器登录，再用本地服务携带 Cookie）。" });
}

function openWeather() {
  formSheet("天气", [
    { key: "weatherCity", label: "城市", def: "上海" },
    { key: "weatherLat", label: "纬度", def: "31.2304" },
    { key: "weatherLon", label: "经度", def: "121.4737" },
  ], { hint: "使用 Open-Meteo，免费且无需 Key。" });
}

async function openBridge() {
  openSheet({
    title: "本地服务",
    full: true,
    footer: true,
    build(body, api) {
      body.innerHTML =
        '<div class="card flat"><div class="tr-body"><div class="tr-title">当前地址</div><div class="tr-sub">' + esc(bridge() || "未检测到") + "</div></div>" +
        '<div class="row" style="margin-top:10px;gap:8px"><button class="btn small soft" id="br-check">检测</button><span class="tiny faint" id="br-out"></span></div></div>' +
        '<div class="field"><label>自定义服务地址（可空）</label><input class="input" id="br-url" value="' + esc(getSetting("bridgeUrl", "")) + '" placeholder="例如 http://192.168.1.5:8787" /></div>' +
        '<div class="hint">只有<b>邮箱</b>和 <b>XeLaTeX 编译</b>需要电脑上的服务；复旦登录、课表、通知、eHall 都在手机里完成。需要时在电脑运行 <b>启动 DanLume 手机版.bat</b>，手机与电脑同一 Wi-Fi。</div>' +
        '<div class="code-block">启动 DanLume 手机版.bat</div>';
      const foot = api.foot;
      foot.innerHTML = "";
      const save = el('<button class="btn primary">保存</button>');
      save.onclick = async () => { await setSetting("bridgeUrl", body.querySelector("#br-url").value.trim()); toast("已保存", "ok"); api.close(); };
      foot.appendChild(save);
      body.querySelector("#br-check").onclick = async () => {
        await setSetting("bridgeUrl", body.querySelector("#br-url").value.trim());
        const out = body.querySelector("#br-out");
        out.textContent = "检测中…";
        const health = await checkBridge();
        out.textContent = health ? "正常 · " + JSON.stringify(health.features) : "没有响应";
      };
    },
  });
}

async function openData() {
  const events = await db.all("events");
  const demoSignatures = [
    ["项目周会", "同步本周里程碑进度，确认交付物与风险项。", "09:30"],
    ["完成季度汇报材料", "整理数据看板与关键结论，输出汇报初稿。", "14:00"],
    ["健身训练", "力量训练 45 分钟 + 拉伸。", "18:30"],
    ["设计评审会", "评审新版工作台交互方案，收集反馈。", "10:00"],
    ["整理客户反馈并输出改进清单", "汇总 12 条反馈，输出优先级与负责人建议。", "16:00"],
  ];
  const isDemo = (ev) => demoSignatures.some(([t, d, s]) => ev.title === t && ev.description === d && ev.start === s);
  const demoCount = events.filter(isDemo).length;
  const dupGroups = new Map();
  for (const ev of events) {
    const key = ev.title + "|" + ev.date + "|" + ev.start;
    if (!dupGroups.has(key)) dupGroups.set(key, []);
    dupGroups.get(key).push(ev);
  }
  const dupExtras = Array.from(dupGroups.values()).reduce((sum, list) => sum + Math.max(0, list.length - 1), 0);
  openSheet({
    title: "数据与备份",
    full: true,
    build(body, api) {
      body.innerHTML =
        '<div class="card flat"><div class="tr-body"><div class="tr-title">全部数据都在本机</div>' +
        '<div class="tr-sub">应用私有 IndexedDB。卸载应用或清除应用数据会清空。</div></div></div>' +
        '<div class="list" style="margin-top:12px">' +
          '<div class="list-item" id="dt-export"><div class="li-ico">' + icon("download") + '</div><div class="li-body"><div class="li-title">导出备份</div><div class="li-sub">JSON 文件，可存到网盘</div></div><div class="li-trail">' + icon("chevron-right") + "</div></div>" +
          '<div class="list-item" id="dt-import"><div class="li-ico">' + icon("upload") + '</div><div class="li-body"><div class="li-title">导入备份</div><div class="li-sub">合并到当前数据</div></div><div class="li-trail">' + icon("chevron-right") + "</div></div>" +
          '<div class="list-item" id="dt-demo"><div class="li-ico">' + icon("wand") + '</div><div class="li-body"><div class="li-title">清理示例日程</div><div class="li-sub">' + (demoCount ? "发现 " + demoCount + " 条首次启动示例，可删除" : "没有示例日程") + '</div></div><div class="li-trail">' + icon("chevron-right") + "</div></div>" +
          '<div class="list-item" id="dt-dup"><div class="li-ico">' + icon("layers") + '</div><div class="li-body"><div class="li-title">检查重复日程</div><div class="li-sub">' + (dupExtras ? "发现 " + dupExtras + " 条重复" : "没有重复日程") + '</div></div><div class="li-trail">' + icon("chevron-right") + "</div></div>" +
          '<div class="list-item" id="dt-clear"><div class="li-ico" style="color:var(--danger);background:color-mix(in srgb, var(--danger) 12%, transparent)">' + icon("trash") + '</div><div class="li-body"><div class="li-title" style="color:var(--danger)">清空全部数据</div><div class="li-sub">谨慎操作，无法恢复</div></div><div class="li-trail">' + icon("chevron-right") + "</div></div>" +
        "</div>";
      body.querySelector("#dt-export").onclick = async () => {
        const payload = await exportBackup();
        downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), "danlume-backup-" + dateStr() + ".json");
        toast("已导出", "ok");
      };
      body.querySelector("#dt-import").onclick = () => {
        const input = document.createElement("input");
        input.type = "file"; input.accept = ".json,application/json";
        input.onchange = async () => {
          const f = input.files && input.files[0];
          if (!f) return;
          try {
            await importBackup(JSON.parse(await readFile(f, "text")));
            toast("导入完成", "ok");
            api.close(); refreshCurrent();
          } catch (e) { toast("导入失败：" + (e.message || e), "err"); }
        };
        input.click();
      };
      body.querySelector("#dt-demo").onclick = async () => {
        if (!demoCount) { toast("没有示例日程"); return; }
        const ok = await confirmDialog({ title: "清理示例日程", message: "将删除 " + demoCount + " 条首次启动写入的示例日程（标题、时间、描述都匹配才删）。", ok: "删除", danger: true });
        if (!ok) return;
        for (const ev of events.filter(isDemo)) await db.del("events", ev.id);
        toast("已删除 " + demoCount + " 条示例", "ok");
        api.close();
        refreshCurrent();
      };
      body.querySelector("#dt-dup").onclick = async () => {
        if (!dupExtras) { toast("没有发现重复日程"); return; }
        const ok = await confirmDialog({ title: "清理重复日程", message: "标题、日期、开始时间完全相同的日程有 " + dupExtras + " 条重复；每组保留最早创建的一条。", ok: "清理", danger: true });
        if (!ok) return;
        let removed = 0;
        for (const list of dupGroups.values()) {
          if (list.length < 2) continue;
          const sorted = list.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
          for (const ev of sorted.slice(1)) { await db.del("events", ev.id); removed++; }
        }
        toast("已清理 " + removed + " 条重复", "ok");
        api.close();
        refreshCurrent();
      };
      body.querySelector("#dt-clear").onclick = async () => {
        const ok = await confirmDialog({ title: "清空全部数据", message: "所有日程、备忘、文献、对话都会删除，无法恢复。", ok: "清空", danger: true });
        if (!ok) return;
        for (const s of ["events", "memos", "mails", "notices", "homework", "docs", "lits", "litProjects", "chats", "focus", "files", "settings", "meta"]) {
          await db.clear(s);
        }
        location.reload();
      };
    },
  });
}

function openPrivacy() {
  openSheet({
    title: "隐私",
    build(body) {
      body.innerHTML =
        '<div class="rich">' +
        "<p>这是一个<b>本地优先</b>的应用：</p>" +
        "<ul><li>日程、备忘、文献、对话都存在浏览器的 IndexedDB 里，不上传服务器。</li>" +
        "<li>AI 对话直接发给你自己配置的模型服务。</li>" +
        "<li>邮箱密码在 APK 里用 Android Keystore 加密保存在本机；网页版才由电脑服务加密保存。</li>" +
        "<li>天气用 Open-Meteo，只发送坐标。</li></ul>" +
        "<p>不要在公共电脑上保存访问密钥和邮箱授权码。</p></div>";
    },
  });
}

function openAbout() {
  openSheet({
    title: "关于",
    build(body) {
      body.innerHTML =
        '<div class="center" style="padding:10px 0 4px"><img src="icons/app-192.png" width="72" height="72" style="border-radius:20px;box-shadow:var(--shadow-lg)" alt="" />' +
        '<div style="font-size:19px;font-weight:750;margin-top:10px">DanLume · 手机版</div>' +
        '<div class="small muted">v1.2.2 · 本地优先</div></div>' +
        '<div class="rich" style="margin-top:12px"><p>把桌面版的日历、邮箱、教务通知、备忘、作业、eHall、空教室、文档、文献库、公式与 AI 助手装进手机。</p>' +
        "<p>技术：原生 ES Modules + IndexedDB + KaTeX + marked；APK 内置 JavaMail 收发邮件与复旦认证。</p></div>";
    },
  });
}
