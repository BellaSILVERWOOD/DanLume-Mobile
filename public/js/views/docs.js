/* 文档：本机文件浏览（PDF / 图片 / 文本） */
import { db } from "../db.js";
import { setHeader } from "../shell.js";
import { icon } from "../icons.js";
import { esc, toast, emptyState, openSheet, confirmDialog, actionSheet, qs, el } from "../ui.js";
import { formatBytes, fmtRelative, downloadBlob, readFile, uid } from "../util.js";

let rootEl = null;
let files = [];
let filter = "all";
let query = "";

export async function render(root) {
  rootEl = root;
  setHeader("文档", "", [
    { icon: "plus", title: "添加文件", onClick: () => addFiles() },
  ]);
  files = await db.all("docs");
  paint();
  return () => {};
}

function kindOf(f) {
  const type = f.type || "";
  const name = (f.name || "").toLowerCase();
  if (type.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("text/") || /\.(txt|md|csv|json|log)$/.test(name)) return "text";
  return "other";
}
const KIND_ICON = { pdf: "file-text", image: "image", text: "file", other: "file" };

function paint() {
  const list = files.filter((f) => filter === "all" || kindOf(f) === filter)
    .filter((f) => !query || (f.name || "").toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  rootEl.innerHTML =
    '<div class="search" style="margin-bottom:10px">' + icon("search") +
      '<input id="doc-search" placeholder="搜索文件…" value="' + esc(query) + '" /></div>' +
    '<div class="chips" style="margin-bottom:12px">' +
      [["all", "全部"], ["pdf", "PDF"], ["image", "图片"], ["text", "文本"], ["other", "其它"]].map(([v, l]) =>
        '<button class="chip ' + (filter === v ? "active" : "") + '" data-filter="' + v + '">' + l + "</button>").join("") +
    "</div>" +
    (list.length ? '<div class="list">' + list.map((f) => {
      const kind = kindOf(f);
      return '<div class="list-item" data-doc="' + f.id + '">' +
        '<div class="li-ico">' + icon(KIND_ICON[kind]) + "</div>" +
        '<div class="li-body"><div class="li-title">' + esc(f.name) + "</div>" +
        '<div class="li-sub">' + formatBytes(f.size) + " · " + esc(fmtRelative(f.createdAt)) + "</div></div>" +
        '<div class="li-trail">' + icon("chevron-right") + "</div></div>";
    }).join("") + "</div>"
      : '<div class="card">' + emptyState("folder", "还没有文档", "把 PDF、图片或文本放进来，随时在手机上看。",
          '<button class="btn small primary" id="doc-add">添加文件</button>') + "</div>") +
    '<div class="hint" style="margin-top:12px">文件保存在本机浏览器里（单个建议不超过 20MB）；清除站点数据会丢失。</div>' +
    '<div style="height:16px"></div>';

  const search = rootEl.querySelector("#doc-search");
  search.addEventListener("input", (e) => { query = e.target.value; paint(); });
  rootEl.querySelectorAll("[data-filter]").forEach((b) => b.onclick = () => { filter = b.dataset.filter; paint(); });
  const add = rootEl.querySelector("#doc-add");
  if (add) add.onclick = () => addFiles();
  rootEl.querySelectorAll("[data-doc]").forEach((n) => n.onclick = () => {
    const f = files.find((x) => x.id === n.dataset.doc);
    if (f) openDoc(f);
  });
}

async function addFiles() {
  const input = document.createElement("input");
  input.type = "file"; input.multiple = true;
  input.onchange = async () => {
    const list = Array.from(input.files || []);
    let added = 0;
    for (const f of list) {
      if (f.size > 20 * 1024 * 1024) { toast(f.name + " 超过 20MB", "err"); continue; }
      const kind = kindOf({ name: f.name, type: f.type });
      const record = { id: uid(), name: f.name, type: f.type, size: f.size, blob: f, createdAt: Date.now() };
      if (kind === "text") record.text = await readFile(f, "text").catch(() => "");
      await db.put("docs", record);
      added++;
    }
    files = await db.all("docs");
    paint();
    if (added) toast("已添加 " + added + " 个文件", "ok");
  };
  input.click();
}

async function openDoc(f) {
  const kind = kindOf(f);
  const url = f.blob ? URL.createObjectURL(f.blob) : "";
  openSheet({
    title: f.name,
    full: true,
    build(body, api) {
      let preview = "";
      if (kind === "pdf" && url) preview = '<iframe src="' + url + '" style="width:100%;height:68vh;border:0;border-radius:14px;background:var(--surface-2)"></iframe>';
      else if (kind === "image" && url) preview = '<img src="' + url + '" style="max-width:100%;border-radius:14px" alt="" />';
      else if (kind === "text") preview = '<pre class="code-block" style="max-height:68vh;overflow:auto;white-space:pre-wrap;font-family:var(--font-mono);font-size:12px">' + esc(f.text || "") + "</pre>";
      else preview = '<div class="card flat"><div class="small muted">这种格式不能直接预览，可以下载到手机再用其它应用打开。</div></div>';
      body.innerHTML = preview +
        '<div class="row small muted" style="margin-top:10px;gap:12px"><span>' + formatBytes(f.size) + "</span><span>" + esc(f.type || "未知类型") + "</span></div>" +
        '<div class="btn-row" style="margin-top:10px">' +
          (url ? '<a class="btn soft" href="' + url + '" target="_blank" download="' + esc(f.name) + '">' + icon("external") + "打开</a>" : "") +
          '<button class="btn ghost" id="d-dl">' + icon("download") + "下载</button>" +
        "</div>" +
        '<button class="btn ghost" id="d-del" style="width:100%;margin-top:10px;color:var(--danger)">' + icon("trash") + "删除文件</button>";
      const dl = body.querySelector("#d-dl");
      dl.onclick = () => { if (f.blob) downloadBlob(f.blob, f.name); else downloadBlob(new Blob([f.text || ""], { type: "text/plain" }), f.name); };
      body.querySelector("#d-del").onclick = async () => {
        const ok = await confirmDialog({ title: "删除文件", message: "文件会从本机删除。", ok: "删除", danger: true });
        if (!ok) return;
        await db.del("docs", f.id);
        if (url) URL.revokeObjectURL(url);
        api.close();
        files = await db.all("docs"); paint();
      };
    },
  });
}
