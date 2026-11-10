/* Markdown + LaTeX 渲染（marked + DOMPurify + KaTeX auto-render） */
const DELIMS = [
  { left: "$$", right: "$$", display: true },
  { left: "\\[", right: "\\]", display: true },
  { left: "\\begin{equation}", right: "\\end{equation}", display: true },
  { left: "\\begin{align}", right: "\\end{align}", display: true },
  { left: "\\begin{aligned}", right: "\\end{aligned}", display: true },
  { left: "\\begin{cases}", right: "\\end{cases}", display: true },
  { left: "\\begin{pmatrix}", right: "\\end{pmatrix}", display: true },
  { left: "\\begin{bmatrix}", right: "\\end{bmatrix}", display: true },
  { left: "\\begin{vmatrix}", right: "\\end{vmatrix}", display: true },
  { left: "\\begin{array}", right: "\\end{array}", display: true },
  { left: "\\(", right: "\\)", display: false },
  { left: "$", right: "$", display: false },
];

let configured = false;
function setupMarked() {
  if (configured || !window.marked) return;
  configured = true;
  window.marked.setOptions({ gfm: true, breaks: true });
}

/** 把裸的 \begin{...}...\end{...} 包进 $$，方便 KaTeX 识别 */
export function wrapBareEnvs(src) {
  if (!src || src.indexOf("\\begin{") === -1) return src;
  return src.replace(/(?<!\$)\\begin\{(equation|align|aligned|cases|pmatrix|bmatrix|vmatrix|array|matrix|gather|split)\*?\}[\s\S]*?\\end\{\1\*?\}/g,
    (m) => "\n$$\n" + m + "\n$$\n");
}

export function mdToHtml(text, { sanitize = true } = {}) {
  setupMarked();
  if (!window.marked) return "<p>" + String(text || "").replace(/</g, "&lt;") + "</p>";
  let src = String(text || "");
  src = wrapBareEnvs(src);
  // 先把 $$…$$ 与 \[…\] 块抽出来，避免 markdown 的换行把定界符拆到不同节点
  const blocks = [];
  const stash = (tex) => { blocks.push(tex); return "MATHBLOCKTOKEN" + (blocks.length - 1) + "X"; };
  src = src.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => "\n\n" + stash(tex) + "\n\n");
  src = src.replace(/\\\[([\s\S]+?)\\\]/g, (m, tex) => "\n\n" + stash(tex) + "\n\n");
  let html = "";
  try { html = window.marked.parse(src); } catch (e) { html = "<p>" + src + "</p>"; }
  if (sanitize && window.DOMPurify) {
    html = window.DOMPurify.sanitize(html, {
      ADD_ATTR: ["target", "rel", "class"],
      FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed"],
      FORBID_ATTR: ["onerror", "onload", "onclick", "style"],
    });
  }
  if (blocks.length && window.katex) {
    html = html.replace(/MATHBLOCKTOKEN(\d+)X/g, (m, i) => {
      const tex = blocks[Number(i)];
      try {
        return '<div class="math-display">' + window.katex.renderToString(tex, { displayMode: true, throwOnError: false, strict: false }) + "</div>";
      } catch (e) {
        return '<div class="math-display math-error">' + tex.replace(/</g, "&lt;") + "</div>";
      }
    });
    html = html.replace(/<p>\s*(<div class="math-display[\s\S]*?<\/div>)\s*<\/p>/g, "$1");
  }
  return html;
}

export function renderMath(root) {
  if (!window.renderMathInElement || !window.katex) return;
  try {
    window.renderMathInElement(root, {
      delimiters: DELIMS,
      throwOnError: false,
      strict: false,
      trust: false,
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
      errorColor: "#B33F3B",
    });
  } catch (e) {
    console.warn("math render failed", e);
  }
}

/** 渲染到元素：markdown + 数学 */
export function renderMarkdownInto(el, text, opts = {}) {
  el.innerHTML = mdToHtml(text, opts);
  renderMath(el);
  el.querySelectorAll("a[href]").forEach((a) => {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
  return el;
}

/** 纯文本预览（去 markdown 标记） */
export function plainPreview(md, limit = 80) {
  let t = String(md || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~`|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > limit ? t.slice(0, limit) + "…" : t;
}

/** 简单渲染一段 LaTeX（公式页预览用） */
export function renderLatexPreview(container, body, displayMode = false) {
  if (!window.katex) return;
  container.innerHTML = "";
  const parts = String(body || "").split(/\n{2,}/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const block = document.createElement("div");
    block.style.margin = "6px 0";
    try {
      window.katex.render(trimmed, block, { displayMode, throwOnError: false, strict: false });
    } catch (e) {
      block.textContent = trimmed;
    }
    container.appendChild(block);
  }
  if (!container.children.length) {
    container.innerHTML = '<span class="faint small">在左侧输入 LaTeX，这里实时预览</span>';
  }
}
