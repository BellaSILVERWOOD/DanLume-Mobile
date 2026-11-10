/* 通知：教务 / eHall 通知流 */
import { db, getSetting, addRow } from "../db.js";
import { setHeader, navigate } from "../shell.js";
import { icon } from "../icons.js";
import { esc, toast, emptyState, openSheet, actionSheet, promptDialog, confirmDialog } from "../ui.js";
import { fmtRelative, fmtDateCN } from "../util.js";
import { bridgeFetch } from "../api.js";

let rootEl = null;
let all = [];
let filter = "all";

export async function render(root) {
  rootEl = root;
  setHeader("通知", "教务与 eHall 通知流", [
    { icon: "refresh", title: "抓取", onClick: () => fetchNotices() },
    { icon: "check", title: "全部已读", onClick: () => markAllRead() },
  ]);
  await reload();
  return () => {};
}

async function reload() {
  all = await db.all("notices");
  all.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || "") || (b.fetchedAt || 0) - (a.fetchedAt || 0));
  paint();
}

function paint() {
  if (!rootEl) return;
  const unread = all.filter((n) => !n.read).length;
  const list = all.filter((n) => filter === "unread" ? !n.read : true);
  rootEl.innerHTML =
    '<div class="row" style="gap:8px;margin-bottom:10px">' +
      '<div class="segmented" id="nt-filter" style="flex:1">' +
        '<button data-v="all" class="' + (filter === "all" ? "active" : "") + '">全部 ' + all.length + "</button>" +
        '<button data-v="unread" class="' + (filter === "unread" ? "active" : "") + '">未读 ' + unread + "</button>" +
      "</div>" +
      '<button class="icon-btn" id="nt-add" title="手动添加">' + icon("plus") + "</button>" +
    "</div>" +
    (list.length ? '<div class="list">' + list.map((n) =>
      '<div class="list-item" data-notice="' + n.id + '">' +
        (n.read ? '<div style="width:6px"></div>' : '<div class="notice-dot"></div>') +
        '<div class="li-body"><div class="li-title" style="font-weight:' + (n.read ? 500 : 650) + '">' + esc(n.title) + "</div>" +
          '<div class="li-sub">' + esc(n.source || "通知") + " · " + esc(n.publishedAt ? fmtDateCN(n.publishedAt.slice(0, 10)) : fmtRelative(n.fetchedAt)) + "</div></div>" +
        '<div class="li-trail">' + icon("chevron-right") + "</div>" +
      "</div>").join("") + "</div>"
      : '<div class="card">' + emptyState("bell", filter === "unread" ? "没有未读通知" : "还没有通知",
          "登录复旦账号后，点「抓取通知」自动同步教务处最新公告。",
          '<button class="btn small primary" id="nt-fetch">抓取通知</button>') + "</div>") +
    '<div class="hint" style="margin-top:12px">抓取会把教务处通知公告页的最新内容收进来，已有链接会自动去重。</div>' +
    '<div style="height:20px"></div>';

  rootEl.querySelectorAll("#nt-filter button").forEach((b) => {
    b.onclick = () => { filter = b.dataset.v; paint(); };
  });
  const fetchBtn = rootEl.querySelector("#nt-fetch");
  if (fetchBtn) fetchBtn.onclick = () => fetchNotices();
  rootEl.querySelector("#nt-add").onclick = () => addNoticeManually();
  rootEl.querySelectorAll("[data-notice]").forEach((n) => {
    n.onclick = () => {
      const item = all.find((x) => x.id === n.dataset.notice);
      if (item) openNotice(item);
    };
  });
}

function openNotice(item) {
  openSheet({
    title: "通知",
    build(body, api) {
      body.innerHTML =
        '<div style="font-size:16px;font-weight:650;line-height:1.5">' + esc(item.title) + "</div>" +
        '<div class="row small muted" style="gap:8px"><span>' + esc(item.source || "通知") + "</span>" +
          (item.publishedAt ? "<span>·</span><span>" + esc(item.publishedAt) + "</span>" : "") + "</div>" +
        (item.summary ? '<div class="card flat tight small">' + esc(item.summary) + "</div>" : "") +
        '<div class="code-block">' + esc(item.url) + "</div>" +
        '<div class="btn-row"><button class="btn soft" id="nt-open">' + icon("external") + "打开原文</button>" +
        '<button class="btn ghost" id="nt-del" style="color:var(--danger)">删除</button></div>';
      qsById(body, "nt-open").onclick = () => {
        window.open(item.url, "_blank", "noopener");
        markRead(item, true);
      };
      qsById(body, "nt-del").onclick = async () => {
        const ok = await confirmDialog({ title: "删除通知", message: "只会从这份列表里删掉。", ok: "删除", danger: true });
        if (!ok) return;
        await db.del("notices", item.id);
        api.close();
        reload();
      };
      markRead(item, false);
    },
    footer: null,
  });
}
function qsById(root, id) { return root.querySelector("#" + id); }

async function markRead(item, reRender) {
  if (!item.read) {
    await db.put("notices", { ...item, read: 1 });
    window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "notices" } }));
    if (reRender !== false) reload();
  }
}
async function markAllRead() {
  const unread = all.filter((n) => !n.read);
  if (!unread.length) { toast("没有未读通知"); return; }
  for (const n of unread) await db.put("notices", { ...n, read: 1 });
  toast("已全部标为已读", "ok");
  await reload();
}

async function addNoticeManually() {
  const title = await promptDialog({ title: "添加通知", label: "标题", placeholder: "例如：关于期末教学安排的通知" });
  if (!title) return;
  const url = await promptDialog({ title: "原文链接", label: "URL（可空）", placeholder: "https://…" });
  const row = {
    id: "n" + Date.now().toString(36), source: "手动", title, url: url || "",
    publishedAt: new Date().toISOString().slice(0, 10), read: 0, fetchedAt: Date.now(),
  };
  await db.put("notices", row);
  toast("已添加", "ok");
  await reload();
}

async function fetchNotices() {
  if (getSetting("fudanLoggedIn", "0") !== "1") {
    toast("请先在登录页验证复旦账号");
    const { showLoginGateAgain } = await import("../login.js");
    showLoginGateAgain();
    return;
  }
  toast("正在抓取教务通知…");
  try {
    const { syncNotices } = await import("../fudan.js");
    const result = await syncNotices();
    toast(result.added ? "新增 " + result.added + " 条通知" : "没有新的通知", result.added ? "ok" : "");
    await reload();
  } catch (e) {
    toast("抓取失败：" + (e.message || e), "err");
  }
}
