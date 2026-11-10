/* 更多：功能总览 / 数据备份 */
import { db, getSetting, setSetting, exportBackup, importBackup } from "../db.js";
import { setHeader, navigate, refreshCurrent } from "../shell.js";
import { icon } from "../icons.js";
import { esc, toast, confirmDialog, openSheet } from "../ui.js";
import { downloadBlob, readFile } from "../util.js";
import { applyTheme, isDark } from "../ui.js";

const TOOLS = [
  { route: "notices", icon: "bell", title: "通知", desc: "教务与 eHall 通知流", color: "#FF9500" },
  { route: "memos", icon: "note", title: "备忘", desc: "富文本速记，自动保存", color: "#AF52DE" },
  { route: "homework", icon: "book", title: "作业", desc: "课程作业与截止时间", color: "#30B0C7" },
  { route: "ehall", icon: "school", title: "eHall", desc: "校园服务与内嵌网页", color: "#3B6EA5" },
  { route: "classroom", icon: "grid", title: "空教室", desc: "按楼栋看空闲时段", color: "#2F8F8A" },
  { route: "docs", icon: "folder", title: "文档", desc: "PDF / 文本 / 图片", color: "#C2703E" },
  { route: "lit", icon: "book-open", title: "文献库", desc: "管理、概述、引用导出", color: "#8B5CF6" },
  { route: "latex", icon: "sigma", title: "公式", desc: "LaTeX 编辑与实时预览", color: "#B04A5A" },
  { route: "focus", icon: "timer", title: "专注", desc: "番茄钟与专注记录", color: "#6B7A3A" },
  { route: "report", icon: "send", title: "工作汇报", desc: "勾选日程生成周报邮件", color: "#2F7A5F" },
  { route: "mail", icon: "mail", title: "邮箱", desc: "收件箱 / 发件箱 / 汇报", color: "#007AFF" },
  { route: "settings", icon: "settings", title: "设置", desc: "外观、AI、课表、账户", color: "#5A5F73" },
];

export async function render(root) {
  setHeader("更多", "全部功能与数据", [
    { icon: isDark() ? "sun" : "moon", title: "切换主题", onClick: async () => {
        await setSetting("theme", isDark() ? "light" : "dark"); applyTheme(); refreshCurrent();
      } },
  ]);
  const [events, memos, lits, docs, chats] = await Promise.all([
    db.all("events"), db.all("memos"), db.all("lits"), db.all("docs"), db.all("chats"),
  ]);
  const name = getSetting("userName", "") || "同学";
  const school = getSetting("userSchool", "") || "本地优先 · 你的数据只在这台设备上";

  root.innerHTML =
    '<div class="card" style="background:linear-gradient(135deg, color-mix(in srgb, var(--accent) 14%, var(--surface)), var(--surface) 75%)">' +
      '<div class="row" style="gap:14px">' +
        '<div class="avatar" style="width:52px;height:52px;font-size:19px;background:var(--accent);color:#fff">' + esc(name.slice(0, 1)) + "</div>" +
        '<div style="min-width:0"><div style="font-size:18px;font-weight:700">' + esc(name) + "</div>" +
          '<div class="small muted ellipsis" style="margin-top:2px">' + esc(school) + "</div></div>" +
        '<span class="spacer"></span>' +
        '<button class="icon-btn" data-go="settings">' + icon("chevron-right") + "</button>" +
      "</div>" +
      '<div class="row" style="margin-top:16px;gap:18px">' +
        '<div><div class="stat-num">' + events.length + '</div><div class="tiny muted">日程</div></div>' +
        '<div><div class="stat-num">' + memos.length + '</div><div class="tiny muted">备忘</div></div>' +
        '<div><div class="stat-num">' + lits.length + '</div><div class="tiny muted">文献</div></div>' +
        '<div><div class="stat-num">' + docs.length + '</div><div class="tiny muted">文档</div></div>' +
        '<div><div class="stat-num">' + chats.length + '</div><div class="tiny muted">对话</div></div>' +
      "</div>" +
    "</div>" +

    '<div class="section-title"><span>功能</span></div>' +
    '<div class="tool-grid">' + TOOLS.map((t) =>
      '<button class="tool-tile" data-go="' + t.route + '">' +
        '<span class="tool-ico" style="color:' + t.color + ';background:color-mix(in srgb, ' + t.color + ' 13%, transparent)">' + icon(t.icon) + "</span>" +
        '<span class="tool-body"><span class="tool-title">' + t.title + "</span>" +
        '<span class="tool-desc">' + t.desc + "</span></span>" +
      "</button>").join("") + "</div>" +

    '<div class="section-title"><span>数据</span></div>' +
    '<div class="list">' +
      '<div class="list-item" id="export-data"><div class="li-ico">' + icon("download") + "</div>" +
        '<div class="li-body"><div class="li-title">导出备份</div><div class="li-sub">把日程、备忘、文献等导出成一个 JSON 文件</div></div>' +
        '<div class="li-trail">' + icon("chevron-right") + "</div></div>" +
      '<div class="list-item" id="import-data"><div class="li-ico">' + icon("upload") + "</div>" +
        '<div class="li-body"><div class="li-title">导入备份</div><div class="li-sub">从备份文件恢复（会合并到现有数据）</div></div>' +
        '<div class="li-trail">' + icon("chevron-right") + "</div></div>" +
      '<div class="list-item" data-go="settings"><div class="li-ico">' + icon("server") + "</div>" +
        '<div class="li-body"><div class="li-title">本地服务与邮箱</div><div class="li-sub">收件箱、工作汇报需要启动本地服务</div></div>' +
        '<div class="li-trail">' + icon("chevron-right") + "</div></div>" +
    "</div>" +

    '<div class="section-title"><span>关于</span></div>' +
    '<div class="card tight">' +
      '<div class="row"><img src="icons/app-96.png" width="38" height="38" style="border-radius:11px" alt="" />' +
        '<div><div class="bold">DanLume · 手机版</div><div class="tiny muted">v1.3.2 · 本地优先</div></div>' +
        '<span class="spacer"></span><span class="badge accent">离线可用</span></div>' +
      '<div class="hint" style="margin-top:10px;padding-left:0">把桌面版的日历、邮箱、通知、备忘、作业、文献库、公式与 AI 助手带到了手机上。数据存在本机 IndexedDB，不上传服务器。</div>' +
      '<div class="btn-row" style="margin-top:12px">' +
        '<button class="btn ghost small" id="about-help">使用说明</button>' +
        '<button class="btn ghost small" id="clear-data" style="color:var(--danger)">清空数据</button>' +
      "</div>" +
    "</div>" +
    '<div style="height:16px"></div>';

  root.querySelectorAll("[data-go]").forEach((n) =>
    n.addEventListener("click", () => navigate(n.dataset.go)));
  root.querySelector("#export-data").onclick = async () => {
    const payload = await exportBackup();
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      "danlume-backup-" + new Date().toISOString().slice(0, 10) + ".json");
    toast("备份已导出", "ok");
  };
  root.querySelector("#import-data").onclick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const text = await readFile(file, "text");
        const ok = await confirmDialog({ title: "导入备份", message: "将把文件里的数据合并到当前数据中，同 ID 的记录会被覆盖。", ok: "导入" });
        if (!ok) return;
        await importBackup(JSON.parse(text));
        toast("导入完成，正在刷新", "ok");
        setTimeout(() => refreshCurrent(), 500);
      } catch (e) {
        toast("导入失败：" + (e.message || e), "err");
      }
    };
    input.click();
  };
  root.querySelector("#about-help").onclick = () => openHelp();
  root.querySelector("#clear-data").onclick = async () => {
    const ok = await confirmDialog({
      title: "清空全部数据", danger: true, ok: "清空",
      message: "日程、备忘、文献、对话都会删除，且无法恢复。建议先导出备份。",
    });
    if (!ok) return;
    for (const s of ["events", "memos", "mails", "notices", "homework", "docs", "lits", "litProjects", "chats", "focus", "files"]) {
      await db.clear(s);
    }
    toast("已清空", "ok");
    refreshCurrent();
  };
  return () => {};
}

function openHelp() {
  openSheet({
    title: "使用说明",
    full: true,
    build(body) {
      body.innerHTML =
        '<div class="rich">' +
        "<p><b>1. 首页与日历</b>：用当天标题右侧的「新建」添加日程；重复日程可以只删一次、删这次及以后或删整个系列。日程到点会在应用内弹出提醒（需要保持页面打开，或允许通知）。</p>" +
        "<p><b>2. AI 助手</b>：先在「设置 → AI 设置」填写你自己模型服务的地址、访问密钥和模型名。可以让我新建日程、查日程、写备忘——在 AI 页右上角打开「让 AI 动手」。</p>" +
        "<p><b>3. 邮箱与工作汇报</b>：浏览器不能直接连 IMAP/SMTP，需要在这台电脑上运行「启动 DanLume 手机版.bat」，手机连同一个 Wi-Fi 打开显示的地址；在「设置 → 邮箱」里填 IMAP / SMTP 即可收发。</p>" +
        "<p><b>4. 数据</b>：全部在手机浏览器本地（IndexedDB），换浏览器或清除站点数据会丢失，记得在「更多 → 导出备份」定期备份。</p>" +
        "<p><b>5. 安装到桌面</b>：iPhone 用 Safari 分享 → 添加到主屏幕；Android 用浏览器菜单 → 添加到主屏幕。用 http 局域网地址时部分浏览器不支持离线缓存，但功能可用。</p>" +
        "</div>";
    },
  });
}
