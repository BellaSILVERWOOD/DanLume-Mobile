/* 公式：LaTeX 编辑器 + 实时预览 + 导出 */
import { setHeader } from "../shell.js";
import { icon } from "../icons.js";
import { esc, toast, openSheet, qs, el } from "../ui.js";
import { renderLatexPreview } from "../markdown.js";
import { downloadText, copyText, downloadBlob } from "../util.js";
import { bridge } from "../api.js";

const LS_KEY = "danlume:latex-doc";
const PACKAGES = ["amsmath", "amssymb", "bm", "graphicx", "booktabs", "geometry", "mathtools", "siunitx", "xcolor", "hyperref"];
const SNIPPETS = [
  { label: "行内公式", tex: "$ $" },
  { label: "行间公式", tex: "\n$$\n  \n$$\n" },
  { label: "分式", tex: "\\frac{a}{b}" },
  { label: "根号", tex: "\\sqrt{x}" },
  { label: "上标", tex: "x^{2}" },
  { label: "下标", tex: "a_{i}" },
  { label: "求和", tex: "\\sum_{i=1}^{n} a_i" },
  { label: "连乘", tex: "\\prod_{i=1}^{n} a_i" },
  { label: "积分", tex: "\\int_{0}^{\\infty} e^{-x}\\,dx" },
  { label: "极限", tex: "\\lim_{x \\to 0} \\frac{\\sin x}{x}" },
  { label: "向量", tex: "\\vec{a}" },
  { label: "范数", tex: "\\|x\\|_2" },
  { label: "内积", tex: "\\langle x, y \\rangle" },
  { label: "希腊字母", tex: "\\alpha \\beta \\gamma \\Delta" },
];
let state = null;
let rootEl = null;

export async function render(root) {
  rootEl = root;
  const saved = JSON.parse(localStorage.getItem(LS_KEY) || "null");
  state = saved && saved.body ? saved : { title: "未命名文档", body: defaultBody(), packages: ["amsmath", "amssymb"] };
  if (!state.packages) state.packages = ["amsmath", "amssymb"];
  setHeader("公式", "", [
    { icon: "copy", title: "复制 LaTeX", onClick: async () => { await copyText(state.body); toast("源码已复制", "ok"); } },
    { icon: "more-horizontal", title: "更多", onClick: () => moreMenu() },
  ]);
  paint();
  return () => {};
}

function defaultBody() {
  return "欧拉公式：\n\n$$e^{i\\pi} + 1 = 0$$\n\n行内公式：$a^2 + b^2 = c^2$\n\n矩阵：\n\n$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$$\n";
}

function paint() {
  rootEl.innerHTML =
    '<input class="input" id="tx-title" value="' + esc(state.title) + '" style="border:0;background:transparent;font-size:18px;font-weight:700;padding:2px 2px 8px;min-height:34px" placeholder="文档标题" />' +
    '<div class="latex-pane" style="margin-bottom:10px">' +
      '<div class="pane-head">' + icon("eye") + '<span>预览</span><span class="spacer"></span><span class="tiny faint" id="tx-count"></span></div>' +
      '<div class="latex-preview" id="tx-preview"></div>' +
    "</div>" +
    '<div class="latex-toolbar" id="tx-toolbar"></div>' +
    '<div class="latex-pane">' +
      '<div class="pane-head">' + icon("sigma") + '<span>LaTeX 源码</span><span class="spacer"></span><button class="btn tiny ghost" id="tx-matrix">矩阵</button></div>' +
      '<textarea id="tx-body" spellcheck="false"></textarea>' +
    "</div>" +
    '<div class="row" style="gap:8px;margin-top:12px">' +
      '<button class="btn small ghost" id="tx-pkg">' + icon("layers") + "宏包 " + state.packages.length + "</button>" +
      '<span class="spacer"></span><button class="btn small soft" id="tx-print">' + icon("file-text") + "打印 / PDF</button>" +
      '<button class="btn small primary" id="tx-export">' + icon("download") + "导出 .tex</button>" +
    "</div>" +
    '<div class="hint" style="margin-top:10px">预览由 KaTeX 渲染；导出的是完整 XeLaTeX 文档，可在电脑上编译。' + (bridge() ? " 本地服务在线时也可以直接编译 PDF。" : "") + "</div>" +
    '<div style="height:16px"></div>';

  const body = rootEl.querySelector("#tx-body");
  const preview = rootEl.querySelector("#tx-preview");
  const count = rootEl.querySelector("#tx-count");
  body.value = state.body;
  let timer = 0;
  const update = () => {
    state.body = body.value;
    renderPreview(preview, state.body);
    count.textContent = state.body.length + " 字符";
    saveDoc();
  };
  body.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(update, 160); });
  body.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = body.selectionStart;
      body.setRangeText("  ", start, body.selectionEnd, "end");
      update();
    }
  });
  rootEl.querySelector("#tx-title").addEventListener("input", (e) => { state.title = e.target.value; saveDoc(); });
  update();

  const toolbar = rootEl.querySelector("#tx-toolbar");
  SNIPPETS.forEach((s) => {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.textContent = s.label;
    btn.onclick = () => insertText(s.tex);
    toolbar.appendChild(btn);
  });
  rootEl.querySelector("#tx-matrix").onclick = () => openMatrix();
  rootEl.querySelector("#tx-pkg").onclick = () => pickPackages();
  rootEl.querySelector("#tx-export").onclick = exportTex;
  rootEl.querySelector("#tx-print").onclick = () => window.print();

  function insertText(tex) {
    const start = body.selectionStart, end = body.selectionEnd;
    body.setRangeText(tex, start, end, "end");
    body.focus();
    update();
  }
  state._insert = insertText;
}

function renderPreview(node, text) {
  const blocks = splitMixed(text);
  renderLatexPreview(node, blocks, false);
}
function splitMixed(text) {
  const out = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push("\\text{" + escapeTex(text.slice(last, m.index)) + "}");
    out.push("\\displaystyle " + (m[1] || m[2]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push("\\text{" + escapeTex(text.slice(last)) + "}");
  return out.join("\n\n");
}
function escapeTex(s) {
  return String(s)
    .replace(/\\/g, " \\textbackslash{} ")
    .replace(/([{}%&#_])/g, "\\$1")
    .replace(/\n/g, "\\\\ ");
}

function saveDoc() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ title: state.title, body: state.body, packages: state.packages })); } catch (e) {}
}

function openMatrix() {
  openSheet({
    title: "插入矩阵",
    footer: true,
    build(body, api) {
      body.innerHTML =
        '<div class="row" style="gap:8px"><div class="field" style="flex:1"><label>行</label><input class="input" id="mx-r" type="number" value="3" min="1" max="8" /></div>' +
        '<div class="field" style="flex:1"><label>列</label><input class="input" id="mx-c" type="number" value="3" min="1" max="8" /></div></div>' +
        '<div class="chips" id="mx-type"><button class="chip active" data-t="pmatrix">圆括号</button><button class="chip" data-t="bmatrix">方括号</button>' +
        '<button class="chip" data-t="vmatrix">竖线</button><button class="chip" data-t="matrix">无括号</button></div>' +
        '<div id="mx-grid" style="overflow:auto"></div>' +
        '<div class="hint">可以直接从 Excel 复制一块区域粘贴进来（Tab / 换行分隔）。</div>';
      let type = "pmatrix";
      const build = () => {
        const rows = Math.max(1, Math.min(8, Number(body.querySelector("#mx-r").value) || 3));
        const cols = Math.max(1, Math.min(8, Number(body.querySelector("#mx-c").value) || 3));
        const grid = body.querySelector("#mx-grid");
        grid.innerHTML = '<div class="matrix-grid" style="grid-template-columns:repeat(' + cols + ',52px)">' +
          Array.from({ length: rows * cols }, (_, i) => '<input data-i="' + i + '" />').join("") + "</div>";
      };
      build();
      body.querySelector("#mx-r").oninput = build;
      body.querySelector("#mx-c").oninput = build;
      body.querySelectorAll("#mx-type button").forEach((b) => b.onclick = () => {
        type = b.dataset.t;
        body.querySelectorAll("#mx-type button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
      });
      body.querySelector("#mx-grid").addEventListener("paste", (e) => {
        const text = e.clipboardData.getData("text");
        if (!text || !/[\t\n]/.test(text)) return;
        e.preventDefault();
        const rows = text.trim().split("\n").map((r) => r.split("\t"));
        body.querySelector("#mx-r").value = rows.length;
        body.querySelector("#mx-c").value = rows[0].length;
        build();
        body.querySelectorAll("#mx-grid input").forEach((inp, i) => {
          const r = Math.floor(i / rows[0].length), c = i % rows[0].length;
          inp.value = (rows[r] && rows[r][c]) || "";
        });
      });
      const foot = api.foot;
      foot.innerHTML = "";
      const insert = el('<button class="btn primary">插入</button>');
      insert.onclick = () => {
        const cells = Array.from(body.querySelectorAll("#mx-grid input")).map((i) => i.value.trim() || "0");
        const cols = Math.max(1, Math.min(8, Number(body.querySelector("#mx-c").value) || 3));
        const rows = [];
        for (let i = 0; i < cells.length; i += cols) rows.push(cells.slice(i, i + cols).join(" & "));
        const tex = "\\begin{" + type + "}\n" + rows.join(" \\\\\n") + "\n\\end{" + type + "}";
        api.close();
        if (state && state._insert) state._insert("\n$$\n" + tex + "\n$$\n");
        toast("已插入矩阵", "ok");
      };
      foot.appendChild(insert);
    },
  });
}

function pickPackages() {
  openSheet({
    title: "宏包",
    build(body) {
      body.innerHTML = '<div class="chips" id="pkg-list">' + PACKAGES.map((p) =>
        '<button class="chip ' + (state.packages.includes(p) ? "active" : "") + '" data-p="' + p + '">' + p + "</button>").join("") + "</div>" +
        '<div class="hint">只影响导出的 .tex 文件；预览由 KaTeX 渲染，不需要真实宏包。</div>';
      body.querySelectorAll("[data-p]").forEach((b) => b.onclick = () => {
        const p = b.dataset.p;
        if (state.packages.includes(p)) state.packages = state.packages.filter((x) => x !== p);
        else state.packages.push(p);
        b.classList.toggle("active");
        saveDoc();
      });
    },
  });
}

function exportTex() {
  const pkgs = Array.from(new Set(["amsmath", "amssymb", ...state.packages])).map((p) => "\\usepackage{" + p + "}");
  const tex = ["\\documentclass[12pt]{ctexart}", ...pkgs, "\\usepackage[margin=2.4cm]{geometry}",
    "\\title{" + state.title.replace(/([{}%&_#])/g, "\\$1") + "}", "\\author{}", "\\date{\\today}",
    "\\begin{document}", "\\maketitle", "", state.body, "", "\\end{document}", ""].join("\n");
  downloadText(tex, (state.title || "document") + ".tex", "application/x-tex;charset=utf-8");
  toast("已导出 .tex", "ok");
}

function moreMenu() {
  openSheet({
    title: "文档",
    build(body, api) {
      body.innerHTML = '<div class="list" style="box-shadow:none">' +
        '<div class="list-item" data-m="new"><div class="li-ico">' + icon("plus") + '</div><div class="li-body"><div class="li-title">新建文档</div><div class="li-sub">清空内容重新开始</div></div></div>' +
        '<div class="list-item" data-m="compile"><div class="li-ico">' + icon("file-text") + '</div><div class="li-body"><div class="li-title">编译为 PDF</div><div class="li-sub">需要电脑安装 XeLaTeX 且本地服务在线</div></div></div>' +
        '<div class="list-item" data-m="copy"><div class="li-ico">' + icon("copy") + '</div><div class="li-body"><div class="li-title">复制源码</div></div></div>' +
        "</div>";
      body.querySelectorAll("[data-m]").forEach((n) => n.onclick = async () => {
        const m = n.dataset.m;
        if (m === "new") { state.title = "未命名文档"; state.body = ""; saveDoc(); api.close(); paint(); }
        else if (m === "copy") { await copyText(state.body); toast("已复制", "ok"); }
        else if (m === "compile") { api.close(); compilePdf(); }
      });
    },
  });
}

async function compilePdf() {
  if (!bridge()) { toast("需要先启动本地服务", "err"); return; }
  toast("正在编译（最长约 90 秒）…");
  const pkgs = Array.from(new Set(["amsmath", "amssymb", ...state.packages])).map((p) => "\\usepackage{" + p + "}");
  const tex = ["\\documentclass[12pt]{ctexart}", ...pkgs, "\\usepackage[margin=2.4cm]{geometry}",
    "\\title{" + state.title + "}", "\\begin{document}", "\\maketitle", "", state.body, "", "\\end{document}", ""].join("\n");
  try {
    const resp = await fetch(bridge() + "/api/latex/compile", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tex }),
    });
    const type = resp.headers.get("content-type") || "";
    if (type.includes("application/pdf")) {
      const blob = await resp.blob();
      downloadBlob(blob, (state.title || "document") + ".pdf");
      toast("PDF 已生成", "ok");
    } else {
      const j = await resp.json();
      toast(j.error || "编译失败", "err");
    }
  } catch (e) { toast("编译失败：" + (e.message || e), "err"); }
}
