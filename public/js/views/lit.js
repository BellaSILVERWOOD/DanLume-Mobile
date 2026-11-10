/* 文献库：目录、星级、多选、中文概述、引用导出、流程图 */
import { db, addRow } from "../db.js";
import { setHeader } from "../shell.js";
import { icon } from "../icons.js";
import { esc, toast, emptyState, openSheet, confirmDialog, promptDialog, actionSheet, qs, el } from "../ui.js";
import { uid, fmtRelative, downloadText, copyText, readFile } from "../util.js";
import { aiText, hasKey } from "../ai.js";

const COLORS = ["#2F7A5F", "#3B6EA5", "#AF52DE", "#C2703E", "#B04A5A", "#2F8F8A"];
let rootEl = null;
let projects = [];
let items = [];
let projectId = "";
let starFilter = 0;
let selection = new Set();
let selectMode = false;
let query = "";

export async function render(root) {
  rootEl = root;
  setHeader("文献库", "", [
    { icon: "plus", title: "添加文献", onClick: () => openEditor(null) },
    { icon: "folder", title: "新建目录", onClick: () => createProject() },
  ]);
  projects = await db.all("litProjects");
  if (!projects.length) {
    await db.put("litProjects", { id: uid(), name: "默认目录", color: COLORS[0], createdAt: Date.now() });
    projects = await db.all("litProjects");
  }
  items = await db.all("lits");
  paint();
  return () => {};
}

function paint() {
  const list = items.filter((x) => (!projectId || x.projectId === projectId) && (!starFilter || (x.rating || 0) >= starFilter) &&
    (!query || (x.title + " " + (x.authors || "") + " " + (x.journal || "")).toLowerCase().includes(query.toLowerCase())));
  list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  const unread = items.length;
  rootEl.innerHTML =
    '<div class="hscroll" style="margin-bottom:10px">' +
      '<button class="chip ' + (!projectId ? "active" : "") + '" data-proj="">全部 ' + items.length + "</button>" +
      projects.map((p) => '<button class="chip ' + (projectId === p.id ? "active" : "") + '" data-proj="' + p.id + '">' +
        '<span class="dot" style="--c:' + (p.color || "#2F7A5F") + '"></span>' + esc(p.name) + "</button>").join("") +
      '<button class="chip" data-newproj="1">' + icon("plus") + "目录</button>" +
    "</div>" +
    '<div class="row" style="gap:8px;margin-bottom:10px">' +
      '<div class="search" style="flex:1">' + icon("search") + '<input id="lit-search" placeholder="搜索标题 / 作者 / 期刊" value="' + esc(query) + '" /></div>' +
      '<button class="icon-btn ' + (selectMode ? "accent" : "") + '" id="lit-select" title="多选">' + icon("check") + "</button>" +
      '<button class="icon-btn" id="lit-star" title="星级筛选">' + icon("star") + "</button>" +
    "</div>" +
    (selection.size ? '<div class="card tight" style="margin-bottom:10px"><div class="row" style="gap:8px">' +
      '<span class="small bold">已选 ' + selection.size + " 篇</span><span class=\"spacer\"></span>" +
      '<button class="btn tiny ghost" id="sel-export">导出</button><button class="btn tiny ghost" id="sel-copy">复制引用</button>' +
      '<button class="btn tiny ghost" id="sel-none">取消</button></div></div>' : "") +
    (list.length ? '<div class="list">' + list.map((x) => {
      const project = projects.find((p) => p.id === x.projectId);
      const on = selection.has(x.id);
      return '<div class="list-item" data-lit="' + x.id + '" style="align-items:flex-start;' + (on ? "background:color-mix(in srgb, var(--accent) 8%, transparent)" : "") + '">' +
        (selectMode ? '<span class="check ' + (on ? "on" : "") + '" style="--c:var(--accent);margin-top:2px">' + icon("check") + "</span>" : "") +
        '<div class="li-body"><div class="lit-title">' + esc(x.title || "(无标题)") + "</div>" +
          '<div class="lit-meta">' + esc([x.authors, x.year, x.journal].filter(Boolean).join(" · ") || "未填写出处") + "</div>" +
          '<div class="row" style="gap:6px;margin-top:6px"><span class="stars">' + "★".repeat(x.rating || 0) + "☆".repeat(5 - (x.rating || 0)) + "</span>" +
          (project ? '<span class="badge">' + esc(project.name) + "</span>" : "") +
          (x.summary ? '<span class="badge accent">已概述</span>' : "") + "</div></div>" +
        (!selectMode ? '<div class="li-trail">' + icon("chevron-right") + "</div>" : "") +
      "</div>";
    }).join("") + "</div>"
      : '<div class="card">' + emptyState("book-open", "目录还是空的", "添加一篇文献，可以自动生成中文概述、复制引用、画流程图。",
          '<button class="btn small primary" id="lit-add">添加文献</button>') + "</div>") +
    '<div class="hint" style="margin-top:12px">点文献看详情；右上角勾选可多选导出。' + (hasKey() ? "" : " AI 概述需要先在设置里配置访问密钥。") + "</div>" +
    '<div style="height:16px"></div>';

  rootEl.querySelectorAll("[data-proj]").forEach((b) => b.onclick = () => { projectId = b.dataset.proj; paint(); });
  rootEl.querySelectorAll("[data-newproj]").forEach((b) => b.onclick = () => createProject());
  const search = rootEl.querySelector("#lit-search");
  search.addEventListener("input", debounce((e) => { query = e.target.value; paint(); }, 220));
  rootEl.querySelector("#lit-select").onclick = () => { selectMode = !selectMode; if (!selectMode) selection.clear(); paint(); };
  rootEl.querySelector("#lit-star").onclick = async () => {
    const v = await actionSheet([{ label: "全部", value: 0 }, { label: "3 星以上", value: 3 }, { label: "4 星以上", value: 4 }, { label: "5 星", value: 5 }], "星级筛选");
    if (v !== null) { starFilter = Number(v); paint(); }
  };
  const add = rootEl.querySelector("#lit-add");
  if (add) add.onclick = () => openEditor(null);
  rootEl.querySelectorAll("[data-lit]").forEach((n) => n.onclick = () => {
    const item = items.find((x) => x.id === n.dataset.lit);
    if (!item) return;
    if (selectMode) {
      if (selection.has(item.id)) selection.delete(item.id); else selection.add(item.id);
      paint();
    } else openDetail(item);
  });
  if (selection.size) {
    rootEl.querySelector("#sel-none").onclick = () => { selection.clear(); paint(); };
    rootEl.querySelector("#sel-copy").onclick = async () => {
      const text = items.filter((x) => selection.has(x.id)).map(citation).join("\n\n");
      await copyText(text); toast("引用已复制", "ok");
    };
    rootEl.querySelector("#sel-export").onclick = () => exportEndNote(items.filter((x) => selection.has(x.id)));
  }
}

function debounce(fn, ms) { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

async function createProject() {
  const name = await promptDialog({ title: "新建目录", label: "目录名称", placeholder: "例如：毕业论文" });
  if (!name) return;
  const p = { id: uid(), name, color: COLORS[projects.length % COLORS.length], createdAt: Date.now() };
  await db.put("litProjects", p);
  projects.push(p);
  projectId = p.id;
  paint();
}

/* ---------------- 文献编辑 ---------------- */
function openEditor(lit) {
  const isNew = !lit;
  const cur = lit ? { ...lit } : {
    id: uid(), projectId: projectId || (projects[0] && projects[0].id) || "", title: "", authors: "",
    year: "", journal: "", doi: "", url: "", tags: "", rating: 0, summary: "", notes: "", addedAt: Date.now(),
  };
  openSheet({
    title: isNew ? "添加文献" : "编辑文献",
    full: true,
    footer: true,
    build(body, api) {
      body.innerHTML =
        '<div class="field"><label>标题</label><input class="input" id="l-title" value="' + esc(cur.title) + '" placeholder="论文标题" /></div>' +
        '<div class="field"><label>作者</label><input class="input" id="l-authors" value="' + esc(cur.authors || "") + '" placeholder="张三, 李四" /></div>' +
        '<div class="input-row"><div class="field"><label>年份</label><input class="input" id="l-year" value="' + esc(cur.year || "") + '" placeholder="2024" /></div>' +
        '<div class="field"><label>期刊 / 会议</label><input class="input" id="l-journal" value="' + esc(cur.journal || "") + '" placeholder="Nature" /></div></div>' +
        '<div class="field"><label>DOI</label><input class="input" id="l-doi" value="' + esc(cur.doi || "") + '" placeholder="10.xxxx/xxxxx" /></div>' +
        '<div class="field"><label>链接</label><input class="input" id="l-url" value="' + esc(cur.url || "") + '" placeholder="https://…" /></div>' +
        '<div class="field"><label>目录</label><select class="input" id="l-project">' + projects.map((p) =>
          '<option value="' + p.id + '" ' + (p.id === cur.projectId ? "selected" : "") + ">" + esc(p.name) + "</option>").join("") + "</select></div>" +
        '<div class="field"><label>星级</label><div class="chips" id="l-stars">' + [1, 2, 3, 4, 5].map((n) =>
          '<button class="chip ' + (cur.rating >= n ? "active" : "") + '" data-star="' + n + '">' + "★".repeat(n) + "</button>").join("") + "</div></div>" +
        '<div class="field"><label>笔记</label><textarea class="textarea" id="l-notes" placeholder="读后记、关键结论…">' + esc(cur.notes || "") + "</textarea></div>";
      body.querySelectorAll("[data-star]").forEach((b) => b.onclick = () => {
        cur.rating = Number(b.dataset.star);
        body.querySelectorAll("[data-star]").forEach((x, i) => x.classList.toggle("active", i < cur.rating));
      });
      const foot = api.foot;
      foot.innerHTML = "";
      const save = el('<button class="btn primary">' + (isNew ? "添加" : "保存") + "</button>");
      save.onclick = async () => {
        const row = {
          ...cur,
          title: body.querySelector("#l-title").value.trim(),
          authors: body.querySelector("#l-authors").value.trim(),
          year: body.querySelector("#l-year").value.trim(),
          journal: body.querySelector("#l-journal").value.trim(),
          doi: body.querySelector("#l-doi").value.trim(),
          url: body.querySelector("#l-url").value.trim(),
          projectId: body.querySelector("#l-project").value,
          notes: body.querySelector("#l-notes").value,
        };
        if (!row.title) { toast("先填标题", "err"); return; }
        await db.put("lits", row);
        api.close();
        items = await db.all("lits");
        paint();
        toast(isNew ? "已添加" : "已保存", "ok");
      };
      foot.appendChild(save);
    },
  });
}

/* ---------------- 详情 ---------------- */
function openDetail(item) {
  openSheet({
    title: "文献详情",
    full: true,
    build(body, api) {
      const paintBody = () => {
        body.innerHTML =
          '<div><div style="font-size:17px;font-weight:700;line-height:1.45">' + esc(item.title) + "</div>" +
          '<div class="small muted" style="margin-top:6px">' + esc([item.authors, item.year, item.journal].filter(Boolean).join(" · ")) + "</div>" +
          '<div class="row" style="gap:6px;margin-top:8px"><span class="stars">' + "★".repeat(item.rating || 0) + "☆".repeat(5 - (item.rating || 0)) + "</span>" +
          (item.doi ? '<span class="badge">DOI ' + esc(item.doi) + "</span>" : "") + "</div></div>" +
          '<div class="btn-row"><button class="btn small ghost" id="d-edit">' + icon("edit") + "编辑</button>" +
          '<button class="btn small ghost" id="d-url">' + icon("external") + "打开</button>" +
          '<button class="btn small ghost" id="d-pdf">' + icon("paperclip") + "PDF</button></div>" +
          '<div class="section-title"><span>中文概述</span><span class="spacer"></span><button id="d-ai">' + (hasKey() ? "AI 生成" : "需配置密钥") + "</button></div>" +
          '<div class="card flat tight small" id="d-summary">' + (item.summary ? esc(item.summary).replace(/\n/g, "<br>") : '<span class="faint">还没有概述。</span>') + "</div>" +
          (item.notes ? '<div class="section-title"><span>我的笔记</span></div><div class="card flat tight small">' + esc(item.notes).replace(/\n/g, "<br>") + "</div>" : "") +
          '<div class="section-title"><span>引用</span></div>' +
          '<div class="code-block" id="d-gbt">' + esc(citation(item)) + "</div>" +
          '<div class="btn-row"><button class="btn small soft" id="d-copy">复制 GB/T 7714</button><button class="btn small ghost" id="d-bib">BibTeX</button>' +
          '<button class="btn small ghost" id="d-enw">EndNote</button></div>' +
          '<div class="section-title"><span>流程图</span><span class="spacer"></span><button id="d-flow">生成步骤图</button></div>' +
          '<div class="flow" id="d-flow-box">' + (item.steps && item.steps.length ? item.steps.map((s, i) =>
            (i ? '<div class="flow-arrow">↓</div>' : "") + '<div class="flow-step">' + esc(s) + "</div>").join("") : '<div class="hint">把这篇文献的流程/方法画成竖排步骤图。</div>') + "</div>" +
          '<button class="btn ghost" id="d-del" style="width:100%;color:var(--danger);margin-top:10px">' + icon("trash") + "删除文献</button>";
        body.querySelector("#d-edit").onclick = () => { api.close(); openEditor(item); };
        body.querySelector("#d-url").onclick = () => {
          if (item.url) window.open(item.url, "_blank", "noopener");
          else if (item.doi) window.open("https://doi.org/" + item.doi, "_blank", "noopener");
          else toast("没有链接或 DOI");
        };
        body.querySelector("#d-pdf").onclick = async () => {
          const input = document.createElement("input");
          input.type = "file"; input.accept = "application/pdf";
          input.onchange = async () => {
            const f = input.files && input.files[0];
            if (!f) return;
            await db.put("files", { id: "litpdf:" + item.id, name: f.name, type: f.type, blob: f, size: f.size });
            item.pdfName = f.name;
            await db.put("lits", item);
            toast("PDF 已存到本机", "ok");
          };
          input.click();
        };
        body.querySelector("#d-ai").onclick = async () => {
          if (!hasKey()) { toast("先去设置配置访问密钥", "err"); return; }
          body.querySelector("#d-summary").innerHTML = '<span class="faint">正在生成…</span>';
          try {
            const out = await aiText([
              { role: "system", content: "你是学术助手，用中文写 120 字以内的概述，只讲这篇文献做了什么、方法、结论，不要空话。" },
              { role: "user", content: "标题：" + item.title + "\n作者：" + (item.authors || "") + "\n期刊：" + (item.journal || "") + "\n年份：" + (item.year || "") + "\n笔记：" + (item.notes || "") },
            ], { maxTokens: 400, effort: "off" });
            item.summary = out.trim();
            await db.put("lits", item);
            items = await db.all("lits");
            body.querySelector("#d-summary").textContent = item.summary;
            paint();
          } catch (e) {
            body.querySelector("#d-summary").textContent = "生成失败：" + (e.message || e);
          }
        };
        body.querySelector("#d-copy").onclick = async () => { await copyText(citation(item)); toast("已复制", "ok"); };
        body.querySelector("#d-bib").onclick = async () => { await copyText(bibtex(item)); toast("BibTeX 已复制", "ok"); };
        body.querySelector("#d-enw").onclick = () => exportEndNote([item]);
        body.querySelector("#d-flow").onclick = async () => {
          if (!hasKey()) { toast("先去设置配置访问密钥", "err"); return; }
          const box = body.querySelector("#d-flow-box");
          box.innerHTML = '<div class="hint">正在把方法画成步骤…</div>';
          try {
            const out = await aiText([
              { role: "system", content: "把文献的研究方法或论证步骤压缩成 4-6 个短句，每行一个，不要编号，不要解释。" },
              { role: "user", content: "标题：" + item.title + "\n概述：" + (item.summary || "") + "\n笔记：" + (item.notes || "") },
            ], { maxTokens: 400, effort: "off" });
            const steps = out.split("\n").map((s) => s.replace(/^[\d.\-、\s]+/, "").trim()).filter(Boolean).slice(0, 7);
            item.steps = steps;
            await db.put("lits", item);
            box.innerHTML = steps.map((s, i) => (i ? '<div class="flow-arrow">↓</div>' : "") + '<div class="flow-step">' + esc(s) + "</div>").join("");
          } catch (e) { box.innerHTML = '<div class="hint">生成失败：' + esc(e.message || e) + "</div>"; }
        };
        body.querySelector("#d-del").onclick = async () => {
          const ok = await confirmDialog({ title: "删除文献", message: "删除后无法恢复。", ok: "删除", danger: true });
          if (!ok) return;
          await db.del("lits", item.id);
          api.close(); items = await db.all("lits"); paint();
        };
      };
      paintBody();
    },
  });
}

function citation(x) {
  const authors = (x.authors || "").replace(/,/g, ", ");
  const type = x.journal ? "[J]" : "[EB/OL]";
  const parts = [authors ? authors + ". " : "", x.title + ". " + type + " "];
  if (x.journal) parts.push(x.journal + ", " + (x.year || "") + ".");
  else parts.push((x.year ? x.year + ". " : "") + (x.url || (x.doi ? "https://doi.org/" + x.doi : "")) + ".");
  return parts.join("");
}
function bibtex(x) {
  const key = (x.authors || "anon").split(/[,，\s]/)[0] + (x.year || "");
  const lines = ["@article{" + key + ",", "  title = {" + (x.title || "") + "},",
    "  author = {" + (x.authors || "") + "},", "  journal = {" + (x.journal || "") + "},",
    "  year = {" + (x.year || "") + "},"];
  if (x.doi) lines.push("  doi = {" + x.doi + "},");
  if (x.url) lines.push("  url = {" + x.url + "},");
  lines.push("}");
  return lines.join("\n");
}
function exportEndNote(list) {
  const text = list.map((x) => ["%0 Journal Article", "%T " + (x.title || ""), "%A " + (x.authors || ""),
    "%J " + (x.journal || ""), "%D " + (x.year || ""), x.doi ? "%R " + x.doi : "", x.url ? "%U " + x.url : "",
    x.summary ? "%X " + x.summary : "", ""].filter(Boolean).join("\n")).join("\n");
  downloadText(text, "danlume-literature.enw", "text/plain;charset=utf-8");
  toast("已导出 EndNote 文件", "ok");
}
