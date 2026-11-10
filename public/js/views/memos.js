/* 备忘：列表 + 富文本编辑（自动保存） */
import { db } from "../db.js";
import { setHeader } from "../shell.js";
import { icon } from "../icons.js";
import { esc, toast, openSheet, confirmDialog, actionSheet, emptyState, qs, el } from "../ui.js";
import { stripTags, fmtRelative, debounce } from "../util.js";

let memosCache = [];
let rootEl = null;
let query = "";

export async function render(root, ctx) {
  rootEl = root;
  setHeader("备忘", "随手记，自动保存", [
    { icon: "plus", title: "新建", onClick: () => openEditor(null) },
  ]);
  memosCache = await db.all("memos");
  memosCache.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  paint();
  if (ctx.params && ctx.params.new) {
    setTimeout(() => openEditor(null), 200);
  }
  const onData = async () => { memosCache = await db.all("memos"); memosCache.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); paint(); };
  window.addEventListener("danlume:data", onData);
  return () => window.removeEventListener("danlume:data", onData);
}

function paint() {
  if (!rootEl) return;
  const list = memosCache.filter((m) => !query || (m.title + " " + stripTags(m.html)).toLowerCase().includes(query.toLowerCase()));
  rootEl.innerHTML =
    '<div class="search" style="margin-bottom:12px">' + icon("search") +
      '<input id="memo-search" placeholder="搜索备忘…" value="' + esc(query) + '" /></div>' +
    (list.length ? '<div class="list">' + list.map((m) =>
      '<div class="list-item" data-memo="' + m.id + '">' +
        '<div class="li-ico">' + icon("note") + "</div>" +
        '<div class="li-body"><div class="li-title">' + esc(m.title || "无标题") + "</div>" +
          '<div class="li-sub">' + esc(stripTags(m.html).slice(0, 60) || "空备忘") + "</div></div>" +
        '<div class="li-trail">' + esc(fmtRelative(m.updatedAt)) + "</div>" +
      "</div>").join("") + "</div>"
      : '<div class="card">' + emptyState("note", "还没有备忘", "记下想法、清单、临时笔记，输入即自动保存。",
          '<button class="btn small soft" id="memo-new">新建备忘</button>') + "</div>") +
    '<div style="height:20px"></div>';

  const search = rootEl.querySelector("#memo-search");
  search.addEventListener("input", debounce((e) => { query = e.target.value; paint(); }, 220));
  rootEl.querySelectorAll("[data-memo]").forEach((n) => {
    n.addEventListener("click", () => {
      const memo = memosCache.find((m) => m.id === n.dataset.memo);
      if (memo) openEditor(memo);
    });
  });
  const nb = rootEl.querySelector("#memo-new");
  if (nb) nb.onclick = () => openEditor(null);
}

function openEditor(memo) {
  const isNew = !memo;
  let current = memo ? { ...memo } : null;
  let timer = 0;
  let dirty = false;
  let persistNow = () => {};

  openSheet({
    title: isNew ? "新建备忘" : "编辑备忘",
    full: true,
    onClose: () => { try { persistNow(); } catch (e) {} },
    build(body, api) {
      body.style.padding = "0";
      body.style.gap = "0";
      body.innerHTML =
        '<div style="padding:12px 16px 4px"><input class="input" id="memo-title" placeholder="标题" style="border:0;background:transparent;font-size:19px;font-weight:700;padding:6px 0;min-height:36px" /></div>' +
        '<div class="editor-shell" style="flex:1;display:flex;flex-direction:column;border:0;border-top:1px solid var(--line);border-radius:0">' +
          '<div class="editor-toolbar" id="memo-tools"></div>' +
          '<div class="note-editor" id="memo-body" contenteditable="true" data-placeholder="开始写点什么…"></div>' +
        "</div>" +
        '<div class="row" style="padding:8px 16px;border-top:1px solid var(--line);font-size:11px;color:var(--faint)">' +
          '<span id="memo-status">输入即保存</span><span class="spacer"></span>' +
          '<button class="btn tiny ghost" id="memo-del" style="color:var(--danger)">' + icon("trash") + "删除</button>" +
        "</div>";

      const titleEl = qs("#memo-title", body);
      const editor = qs("#memo-body", body);
      const status = qs("#memo-status", body);
      if (memo) { titleEl.value = memo.title || ""; editor.innerHTML = memo.html || ""; }
      titleEl.placeholder = "标题";
      titleEl.addEventListener("input", schedule);

      const tools = qs("#memo-tools", body);
      const cmds = [
        { cmd: "bold", label: "B", style: "font-weight:800" },
        { cmd: "italic", label: "I", style: "font-style:italic" },
        { cmd: "underline", label: "U", style: "text-decoration:underline" },
        { sep: true },
        { cmd: "insertUnorderedList", icon: "list" },
        { cmd: "insertOrderedList", label: "1." },
        { cmd: "todo", label: "☐" },
        { sep: true },
        { cmd: "size", label: "A", style: "font-size:15px" },
        { cmd: "color", label: "A", style: "background:linear-gradient(135deg,#AF52DE,#FF2D55);-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:800" },
        { cmd: "removeFormat", label: "清除", style: "font-size:10px", w: "auto" },
      ];
      cmds.forEach((c) => {
        if (c.sep) { tools.appendChild(el('<div class="sep"></div>')); return; }
        const btn = el('<button type="button">' + (c.icon ? icon(c.icon) : c.label) + "</button>");
        if (c.style) btn.setAttribute("style", (c.style || "") + ";width:" + (c.w || "32px"));
        btn.addEventListener("mousedown", (e) => e.preventDefault());
        btn.onclick = async () => {
          editor.focus();
          if (c.cmd === "todo") {
            document.execCommand("insertHTML", false, '<div class="todo-item"><span class="todo-box">☐</span>&nbsp;</div>');
          } else if (c.cmd === "size") {
            const v = await actionSheet([
              { label: "小字", value: "2" }, { label: "正常", value: "3" },
              { label: "大一点", value: "4" }, { label: "标题", value: "5" },
              { label: "特大", value: "6" },
            ], "字号");
            if (v) document.execCommand("fontSize", false, v);
          } else if (c.cmd === "color") {
            const v = await actionSheet([
              { label: "鼠尾草绿", value: "#2F7A5F" }, { label: "远山蓝", value: "#3B6EA5" },
              { label: "鸢尾紫", value: "#8B5CF6" }, { label: "赭石橙", value: "#C2703E" },
              { label: "胭脂红", value: "#B04A5A" }, { label: "石墨黑", value: "#333333" },
            ], "文字颜色");
            if (v) document.execCommand("foreColor", false, v);
          } else {
            document.execCommand(c.cmd, false, null);
          }
          schedule();
          syncToolState();
        };
        tools.appendChild(btn);
      });

      editor.addEventListener("input", schedule);
      editor.addEventListener("click", (e) => {
        const box = e.target.closest(".todo-box");
        if (!box) return;
        box.textContent = box.textContent.trim() === "☐" ? "☑" : "☐";
        schedule();
      });
      document.execCommand("defaultParagraphSeparator", false, "p");

      function syncToolState() {
        tools.querySelectorAll("button").forEach((b) => b.classList.remove("on"));
      }
      function persist() {
        const title = titleEl.value.trim();
        const html = editor.innerHTML;
        if (isNew) {
          if (!current) {
            if (!title && !stripTags(html)) return;
            const row = { id: "m" + Date.now().toString(36), title: title || "无标题", html, createdAt: Date.now(), updatedAt: Date.now() };
            db.put("memos", row).then(() => { current = row; });
          } else {
            current = { ...current, title: title || "无标题", html, updatedAt: Date.now() };
            db.put("memos", current);
          }
        } else if (current) {
          current = { ...current, title: title || "无标题", html, updatedAt: Date.now() };
          db.put("memos", current);
        }
        status.textContent = "已保存 · " + new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
        dirty = false;
        window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "memos" } }));
      }
      function schedule() {
        dirty = true;
        status.textContent = "正在保存…";
        clearTimeout(timer);
        timer = setTimeout(persist, 550);
      }
      qs("#memo-del", body).onclick = async () => {
        if (!current) { api.close(); return; }
        const ok = await confirmDialog({ title: "删除备忘", message: "删除后无法恢复。", ok: "删除", danger: true });
        if (!ok) return;
        await db.del("memos", current.id);
        toast("已删除");
        api.close();
        window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "memos" } }));
      };
      setTimeout(() => { if (!memo) titleEl.focus(); }, 260);
      persistNow = persist;
    },
  });
}
