/* UI 基础：组件、弹层、提示、主题 */
import { icon } from "./icons.js";
import { escapeHtml } from "./util.js";
import { getSetting } from "./db.js";

export { icon };
export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export function esc(s) { return escapeHtml(s); }
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/* ---------------- Toast ---------------- */
export function toast(msg, type = "") {
  const root = document.getElementById("toast-root");
  const node = el('<div class="toast ' + type + '"></div>');
  node.textContent = msg;
  root.appendChild(node);
  setTimeout(() => {
    node.style.transition = "opacity .25s, transform .25s";
    node.style.opacity = "0";
    node.style.transform = "translateY(6px)";
    setTimeout(() => node.remove(), 260);
  }, type === "err" ? 3600 : 2200);
}

/* ---------------- 底部弹层 ---------------- */
export function openSheet(opts = {}) {
  const overlay = document.getElementById("overlay-root");
  const scrim = el('<div class="scrim"></div>');
  const sheet = el('<div class="sheet' + (opts.full ? " full" : "") + '"></div>');
  const grip = el('<div class="sheet-grip"></div>');
  const head = el('<div class="sheet-head"></div>');
  if (opts.title) {
    const t = el('<div class="sheet-title"></div>');
    t.textContent = opts.title;
    head.appendChild(t);
  }
  const spacer = el('<div class="spacer"></div>');
  head.appendChild(spacer);
  const closeBtn = el('<button class="icon-btn plain" aria-label="关闭">' + icon("x") + "</button>");
  head.appendChild(closeBtn);
  const body = el('<div class="sheet-body"></div>');
  sheet.append(grip, head, body);

  let foot = null;
  if (opts.footer) {
    foot = el('<div class="sheet-foot"></div>');
    sheet.appendChild(foot);
  }
  if (opts.build) opts.build(body, { close: () => close(), sheet, foot, head });

  overlay.append(scrim, sheet);
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => {
    scrim.classList.add("show");
    sheet.classList.add("show");
  });

  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    scrim.classList.remove("show");
    sheet.classList.remove("show");
    document.body.style.overflow = "";
    setTimeout(() => { scrim.remove(); sheet.remove(); }, 340);
    if (opts.onClose) opts.onClose(result);
  }
  closeBtn.addEventListener("click", () => close());
  scrim.addEventListener("click", () => close());
  const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);

  return { body, sheet, foot, close, head };
}

/* ---------------- 对话框 ---------------- */
export function confirmDialog({ title = "确认", message = "", ok = "确定", cancel = "取消", danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("overlay-root");
    const scrim = el('<div class="scrim"></div>');
    const box = el('<div class="dialog"><h3></h3><p></p><div class="btn-row"></div></div>');
    qs("h3", box).textContent = title;
    qs("p", box).textContent = message;
    const row = qs(".btn-row", box);
    const cancelBtn = el('<button class="btn ghost"></button>');
    cancelBtn.textContent = cancel;
    const okBtn = el('<button class="btn ' + (danger ? "danger" : "primary") + '"></button>');
    okBtn.textContent = ok;
    row.append(cancelBtn, okBtn);
    overlay.append(scrim, box);
    requestAnimationFrame(() => { scrim.classList.add("show"); box.classList.add("show"); });
    const done = (v) => {
      scrim.classList.remove("show");
      box.classList.remove("show");
      setTimeout(() => { scrim.remove(); box.remove(); }, 240);
      resolve(v);
    };
    cancelBtn.onclick = () => done(false);
    okBtn.onclick = () => done(true);
    scrim.onclick = () => done(false);
  });
}

export function promptDialog({ title = "输入", label = "", value = "", placeholder = "", multiline = false, ok = "确定" } = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("overlay-root");
    const scrim = el('<div class="scrim"></div>');
    const box = el('<div class="dialog"><h3></h3><p class="lbl"></p><div class="field"></div><div class="btn-row"></div></div>');
    qs("h3", box).textContent = title;
    qs(".lbl", box).textContent = label;
    const field = qs(".field", box);
    const input = multiline
      ? el('<textarea class="textarea"></textarea>')
      : el('<input class="input" type="text" />');
    input.value = value;
    input.placeholder = placeholder;
    field.appendChild(input);
    const row = qs(".btn-row", box);
    const cancelBtn = el('<button class="btn ghost">取消</button>');
    const okBtn = el('<button class="btn primary"></button>');
    okBtn.textContent = ok;
    row.append(cancelBtn, okBtn);
    overlay.append(scrim, box);
    requestAnimationFrame(() => { scrim.classList.add("show"); box.classList.add("show"); });
    setTimeout(() => input.focus(), 80);
    const done = (v) => {
      scrim.classList.remove("show"); box.classList.remove("show");
      setTimeout(() => { scrim.remove(); box.remove(); }, 240);
      resolve(v);
    };
    cancelBtn.onclick = () => done(null);
    scrim.onclick = () => done(null);
    okBtn.onclick = () => done(input.value);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !multiline) done(input.value); });
  });
}

export function actionSheet(items, title = "") {
  return new Promise((resolve) => {
    let settled = false;
    let apiRef = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (apiRef) apiRef.close();
      resolve(value);
    };
    openSheet({
      title,
      build(body, api) {
        apiRef = api;
        body.style.gap = "8px";
        items.forEach((item) => {
          const btn = el('<button class="btn ghost" style="justify-content:flex-start;width:100%"></button>');
          btn.innerHTML = (item.icon ? icon(item.icon) : "") + "<span></span>";
          qs("span", btn).textContent = item.label;
          if (item.danger) { btn.style.color = "var(--danger)"; btn.style.borderColor = "color-mix(in srgb, var(--danger) 25%, transparent)"; }
          btn.onclick = () => finish(item.value ?? item.label);
          body.appendChild(btn);
        });
        const cancel = el('<button class="btn" style="width:100%">取消</button>');
        cancel.onclick = () => finish(null);
        body.appendChild(cancel);
      },
      onClose: () => finish(null),
    });
  });
}

/* ---------------- 小组件 ---------------- */
export function emptyState(iconName, title, sub = "", action = "") {
  return '<div class="empty">' + icon(iconName) +
    '<div class="empty-title">' + esc(title) + "</div>" +
    (sub ? '<div class="empty-sub">' + esc(sub) + "</div>" : "") +
    (action ? '<div style="margin-top:14px">' + action + "</div>" : "") +
    "</div>";
}

export function field(label, controlHtml, hint = "") {
  return '<div class="field"><label>' + esc(label) + "</label>" + controlHtml +
    (hint ? '<div class="hint">' + hint + "</div>" : "") + "</div>";
}

/* 长按：触发前会取消滚动/点击，避免误触 */
export function onLongPress(node, handler, ms = 500) {
  if (!node) return;
  let timer = 0;
  let sx = 0, sy = 0;
  let suppressUntil = 0;
  const isControl = (e) => {
    const t = e.target;
    return t && t.closest && t.closest(".check,[data-check],[data-pick]");
  };
  const clear = () => {
    if (timer) { clearTimeout(timer); timer = 0; }
  };
  const start = (x, y) => {
    clear();
    sx = x; sy = y;
    timer = setTimeout(() => {
      timer = 0;
      suppressUntil = Date.now() + 700;
      try { handler(); } catch (err) {}
    }, ms);
  };
  const move = (x, y) => {
    if (timer && (Math.abs(x - sx) > 10 || Math.abs(y - sy) > 10)) clear();
  };
  const end = (e) => {
    const was = timer === 0 && Date.now() < suppressUntil;
    clear();
    if (was && e) { e.preventDefault(); e.stopPropagation(); }
  };

  node.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || isControl(e)) return;
    start(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  node.addEventListener("touchmove", (e) => {
    if (e.touches.length === 1) move(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  node.addEventListener("touchend", end, { passive: false });
  node.addEventListener("touchcancel", clear, { passive: true });

  node.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || isControl(e)) return;
    start(e.clientX, e.clientY);
  });
  node.addEventListener("mousemove", (e) => move(e.clientX, e.clientY));
  node.addEventListener("mouseup", end);
  node.addEventListener("mouseleave", clear);
  node.addEventListener("contextmenu", (e) => {
    if (Date.now() < suppressUntil) e.preventDefault();
  });
  node.addEventListener("click", (e) => {
    if (Date.now() < suppressUntil) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}

export function toggleRow(title, sub, checked, attrs = "") {
  return '<div class="toggle-row"><div class="tr-body"><div class="tr-title">' + esc(title) +
    '</div><div class="tr-sub">' + sub + '</div></div><label class="switch"><input type="checkbox" ' +
    attrs + (checked ? " checked" : "") + '><span></span></label></div>';
}

export function setBodyLock(lock) { document.body.style.overflow = lock ? "hidden" : ""; }

/* ---------------- 主题 ---------------- */
export const ACCENTS = [
  { value: "#007AFF", label: "iOS 蓝" },
  { value: "#2F7A5F", label: "鼠尾草" },
  { value: "#3B6EA5", label: "远山蓝" },
  { value: "#8B5CF6", label: "鸢尾紫" },
  { value: "#C2703E", label: "赭石橙" },
  { value: "#B04A5A", label: "胭脂" },
  { value: "#2F8F8A", label: "湖青" },
  { value: "#6B7A3A", label: "橄榄" },
  { value: "#5A5F73", label: "石墨" },
];
export const BG_TINTS = [
  { value: "linen", label: "亚麻" },
  { value: "mist", label: "薄雾" },
  { value: "dawn", label: "晨光" },
  { value: "ocean", label: "海盐" },
  { value: "sand", label: "暖沙" },
  { value: "paper", label: "纸白" },
];
export const FONTS = [
  { value: "system", label: "系统默认", stack: '' },
  { value: "sans", label: "苹方 / 黑体", stack: '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif' },
  { value: "serif", label: "宋体 / 衬线", stack: '"Songti SC", "Noto Serif SC", "SimSun", Georgia, serif' },
  { value: "rounded", label: "圆体", stack: '"Yuanti SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif' },
];

export function isDark() {
  const mode = getSetting("theme") || "auto";
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = isDark() ? "dark" : "light";
  root.dataset.bg = getSetting("bg", "linen");
  const accent = getSetting("accent");
  const accent2 = getSetting("accent2");
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-2", accent2);
  const font = FONTS.find((f) => f.value === getSetting("font", "system"));
  if (font && font.stack) root.style.setProperty("--font-ui", font.stack);
  else root.style.removeProperty("--font-ui");
  const glass = getSetting("glass", "1") === "1";
  document.body.classList.toggle("no-glass", !glass);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", isDark() ? "#000000" : "#F2F2F7");
  try {
    if (window.DLNative && window.DLNative.setTheme) window.DLNative.setTheme(isDark() ? "dark" : "light");
  } catch (e) {}
}

let mediaBound = false;
export function bindThemeWatcher() {
  if (mediaBound) return;
  mediaBound = true;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => { if (getSetting("theme", "auto") === "auto") applyTheme(); };
  if (mq.addEventListener) mq.addEventListener("change", handler);
  else if (mq.addListener) mq.addListener(handler);
}

/* ---------------- 文件选择 ---------------- */
export function pickFile(accept = "", multiple = false) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (accept) input.accept = accept;
    input.multiple = multiple;
    input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = () => {
      resolve(multiple ? Array.from(input.files || []) : (input.files && input.files[0]) || null);
      input.remove();
    };
    input.click();
  });
}

export function autoGrow(ta) {
  const fit = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 140) + "px"; };
  ta.addEventListener("input", fit);
  setTimeout(fit, 0);
}

export function segmented(name, options, active, attrs = "") {
  return '<div class="segmented" data-seg="' + name + '" ' + attrs + ">" +
    options.map((o) => '<button type="button" data-value="' + esc(o.value) + '" class="' +
      (String(o.value) === String(active) ? "active" : "") + '">' + esc(o.label) + "</button>").join("") +
    "</div>";
}

/* ---------------- 页面设置 ---------------- */
export function pageTitle(title, sub = "", actions = "") {
  const bar = document.getElementById("topbar");
  bar.innerHTML = '<div class="topbar-logo"><div><div class="topbar-title">' + esc(title) +
    "</div>" + (sub ? '<div class="topbar-sub">' + esc(sub) + "</div>" : "") +
    '</div></div><div class="topbar-actions">' + actions + "</div>";
}

export function mountActions(html) {
  const bar = document.getElementById("topbar");
  const actions = qs(".topbar-actions", bar);
  if (actions) actions.innerHTML = html;
}
