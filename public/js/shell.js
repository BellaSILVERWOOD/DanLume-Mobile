/* 应用外壳：路由、顶栏、底栏 */
import { icon } from "./icons.js";
import { esc } from "./ui.js";

export const TABS = [
  { route: "dashboard", label: "首页", icon: "home" },
  { route: "calendar", label: "日历", icon: "calendar" },
  { route: "mail", label: "邮箱", icon: "mail" },
  { route: "ai", label: "Lume", icon: "sparkles" },
  { route: "more", label: "更多", icon: "grid" },
];

const routes = new Map();
let currentName = "";
let currentDef = null;
let currentParams = {};
let cleanupFn = null;

export function registerRoutes(defs) {
  for (const [name, def] of Object.entries(defs)) routes.set(name, def);
}

export function getRoute() { return currentName; }
export function getParams() { return currentParams; }
export function isTabRoute(name) { return TABS.some((t) => t.route === name); }

export function navigate(name, params = {}, replace = false) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const hash = "#/" + name + (qs.toString() ? "?" + qs.toString() : "");
  if (location.hash === hash && currentName === name) { renderRoute(true); return; }
  if (replace) history.replaceState(null, "", hash);
  else history.pushState(null, "", hash);
  renderRoute();
}

export function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [name, q] = h.split("?");
  const params = {};
  if (q) for (const [k, v] of new URLSearchParams(q)) params[k] = v;
  return { name: name || "dashboard", params };
}

export function buildTabbar() {
  const bar = document.getElementById("tabbar");
  bar.innerHTML = TABS.map((t) =>
    '<button class="tab" data-route="' + t.route + '" type="button">' +
      icon(t.icon) + '<span>' + t.label + "</span>" +
      '<i class="tab-badge" data-badge="' + t.route + '" hidden></i>' +
    "</button>").join("");
  bar.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const r = btn.dataset.route;
      if (r === currentName && document.getElementById("view").scrollTop < 40) return;
      navigate(r);
    });
  });
}

export function setBadge(route, count) {
  const node = document.querySelector('[data-badge="' + route + '"]');
  if (!node) return;
  if (count > 0) { node.hidden = false; node.textContent = count > 99 ? "99+" : String(count); }
  else node.hidden = true;
}

export function setTabActive(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.route === name));
}

export function setHeader(title, sub = "", actions = []) {
  const bar = document.getElementById("topbar");
  const rootPages = new Set(["dashboard", "calendar", "mail", "ai", "more", "settings"]);
  const back = !rootPages.has(currentName) ? '<button class="icon-btn plain" data-h="back" type="button" aria-label="返回">' + icon("chevron-left") + "</button>" : "";
  bar.innerHTML = '<div class="topbar-logo">' + back +
    '<div style="min-width:0"><div class="topbar-title ellipsis">' + esc(title) + "</div>" +
    (sub ? '<div class="topbar-sub ellipsis">' + esc(sub) + "</div>" : "") +
    '</div></div><div class="topbar-actions"></div>';
  const actionsNode = bar.querySelector(".topbar-actions");
  for (const a of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-btn " + (a.cls || "");
    if (a.label) {
      btn.style.width = "auto";
      btn.style.padding = "0 12px";
      btn.innerHTML = (a.icon ? icon(a.icon) : "") + '<span style="font-size:12.5px;font-weight:600;margin-left:4px">' + esc(a.label) + "</span>";
    } else {
      btn.innerHTML = icon(a.icon || "more-horizontal");
      btn.setAttribute("aria-label", a.title || "");
    }
    if (a.onClick) btn.addEventListener("click", a.onClick);
    actionsNode.appendChild(btn);
  }
  const backBtn = bar.querySelector('[data-h="back"]');
  if (backBtn) backBtn.addEventListener("click", () => {
    if (history.length > 1) history.back();
    else navigate("more");
  });
}

export function setTabbarVisible(visible) {
  document.getElementById("tabbar").style.display = visible ? "" : "none";
}

export function setViewPadded(padded) {
  const view = document.getElementById("view");
  view.style.paddingLeft = padded ? "" : "0";
  view.style.paddingRight = padded ? "" : "0";
}

export async function renderRoute(force = false) {
  const { name, params } = parseHash();
  const def = routes.get(name) || routes.get("dashboard");
  if (!def) return;
  if (!force && currentName === name && JSON.stringify(currentParams) === JSON.stringify(params) && currentDef) {
    return;
  }
  currentName = name;
  currentDef = def;
  currentParams = params;
  const view = document.getElementById("view");
  if (typeof cleanupFn === "function") { try { cleanupFn(); } catch (e) {} cleanupFn = null; }
  // 换页时关掉残留的弹层，避免遮住新页面
  const overlay = document.getElementById("overlay-root");
  if (overlay) overlay.innerHTML = "";
  document.body.style.overflow = "";
  setTabActive(def.tab || (isTabRoute(name) ? name : ""));
  setTabbarVisible(def.tab !== false);
  view.className = "view page-enter" + (def.full ? " no-tabbar" : "");
  view.removeAttribute("style");
  view.innerHTML = '<div style="height:8px"></div>';
  view.scrollTop = 0;
  try {
    const mod = await def.load();
    cleanupFn = await mod.render(view, { params, name });
  } catch (err) {
    console.error(err);
    view.innerHTML = '<div class="empty"><div class="empty-title">页面加载失败</div><div class="empty-sub">' +
      esc(err && err.message || String(err)) + "</div></div>";
  }
}

export function refreshCurrent() {
  renderRoute(true);
}

export function boot(initial) {
  buildTabbar();
  window.addEventListener("hashchange", () => renderRoute());
  window.addEventListener("popstate", () => renderRoute());
  if (!location.hash) history.replaceState(null, "", "#/" + (initial || "dashboard"));
  renderRoute();
}

window.addEventListener("danlume:data", () => {
  if (typeof window.__dlDataHook === "function") window.__dlDataHook();
});
