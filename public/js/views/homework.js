/* 作业：课程作业、截止时间、写入日历 */
import { db, addRow } from "../db.js";
import { setHeader, navigate } from "../shell.js";
import { icon } from "../icons.js";
import { esc, toast, emptyState, openSheet, confirmDialog, promptDialog, qs, el, actionSheet } from "../ui.js";
import { dateStr, addDays, diffDays, fmtDateCN, uid } from "../util.js";

let rootEl = null;
let items = [];
let tab = "todo";

export async function render(root) {
  rootEl = root;
  setHeader("作业", "", [
    { icon: "plus", title: "添加作业", onClick: () => openEditor(null) },
    { icon: "refresh", title: "从日历补充", onClick: () => importFromCalendar() },
  ]);
  items = await db.all("homework");
  paint();
  return () => {};
}

function dueText(h) {
  if (!h.due) return "没有截止时间";
  const d = diffDays(dateStr(), h.due.slice(0, 10));
  if (d < 0) return "逾期 " + (-d) + " 天";
  if (d === 0) return "今天截止";
  if (d === 1) return "明天截止";
  if (d <= 7) return d + " 天后截止";
  return fmtDateCN(h.due.slice(0, 10));
}
function dueTone(h) {
  if (!h.due) return "";
  const d = diffDays(dateStr(), h.due.slice(0, 10));
  if (d < 0) return "danger";
  if (d <= 1) return "warn";
  return "";
}

function paint() {
  if (!rootEl) return;
  const todo = items.filter((h) => h.status !== "done").sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const done = items.filter((h) => h.status === "done");
  const list = tab === "done" ? done : todo;
  const nearest = todo.find((h) => h.due);
  rootEl.innerHTML =
    '<div class="card tight" style="background:linear-gradient(135deg, color-mix(in srgb, var(--accent) 12%, var(--surface)), var(--surface) 75%)">' +
      '<div class="row"><div><div class="stat-num">' + todo.length + '<span class="small muted" style="font-weight:500"> 项待完成</span></div>' +
      '<div class="tiny muted" style="margin-top:4px">' + (nearest ? "最近：" + esc(nearest.course) + " · " + esc(nearest.title) + "（" + dueText(nearest) + "）" : "没有待交的作业，轻松一下") + "</div></div>" +
      '<span class="spacer"></span><div class="avatar" style="background:var(--accent);color:#fff">' + icon("book") + "</div></div>" +
    "</div>" +
    '<div class="segmented" id="hw-tabs" style="margin:12px 0">' +
      '<button data-v="todo" class="' + (tab === "todo" ? "active" : "") + '">待完成 ' + todo.length + "</button>" +
      '<button data-v="done" class="' + (tab === "done" ? "active" : "") + '">已完成 ' + done.length + "</button>" +
    "</div>" +
    (list.length ? '<div class="stack">' + list.map((h) =>
      '<div class="card tight" data-hw="' + h.id + '" style="cursor:pointer">' +
        '<div class="row" style="gap:8px"><span class="badge accent">' + esc(h.course || "未分课程") + "</span>" +
          (h.due ? '<span class="badge ' + dueTone(h) + '">' + dueText(h) + "</span>" : "") +
          '<span class="spacer"></span>' +
          '<button class="check ' + (h.status === "done" ? "on" : "") + '" data-toggle="' + h.id + '" aria-label="完成">' + icon("check") + "</button></div>" +
        '<div class="ev-title" style="margin-top:8px;' + (h.status === "done" ? "text-decoration:line-through;opacity:.55" : "") + '">' + esc(h.title) + "</div>" +
        (h.desc ? '<div class="ev-meta">' + esc(h.desc.slice(0, 120)) + "</div>" : "") +
      "</div>").join("") + "</div>"
      : '<div class="card">' + emptyState("book", tab === "done" ? "还没有完成的作业" : "没有待完成的作业",
          "点右上角 + 添加；也可以把作业截止时间写进日历。") + "</div>") +
    '<div class="hint" style="margin-top:12px">小提示：作业卡片点开可以「写入日历」，到截止前 30 分钟会提醒你。</div>' +
    '<div style="height:20px"></div>';

  rootEl.querySelectorAll("#hw-tabs button").forEach((b) => b.onclick = () => { tab = b.dataset.v; paint(); });
  rootEl.querySelectorAll("[data-hw]").forEach((n) => n.onclick = (e) => {
    if (e.target.closest("[data-toggle]")) return;
    const h = items.find((x) => x.id === n.dataset.hw);
    if (h) openEditor(h);
  });
  rootEl.querySelectorAll("[data-toggle]").forEach((n) => n.onclick = async (e) => {
    e.stopPropagation();
    const h = items.find((x) => x.id === n.dataset.toggle);
    if (!h) return;
    await db.put("homework", { ...h, status: h.status === "done" ? "todo" : "done", updatedAt: Date.now() });
    toast(h.status === "done" ? "已恢复" : "完成了");
    items = await db.all("homework");
    paint();
  });
}

function openEditor(h) {
  const isNew = !h;
  const cur = h ? { ...h } : { id: uid(), course: "", title: "", desc: "", due: "", dueTime: "23:59", status: "todo", url: "" };
  openSheet({
    title: isNew ? "添加作业" : "编辑作业",
    full: true,
    footer: true,
    build(body, api) {
      body.innerHTML =
        '<div class="field"><label>课程</label><input class="input" id="hw-course" placeholder="例如：数据结构" /></div>' +
        '<div class="field"><label>作业标题</label><input class="input" id="hw-title" placeholder="例如：第八周作业" /></div>' +
        '<div class="field"><label>截止日期</label><div class="input-row">' +
          '<input class="input" type="date" id="hw-due" />' +
          '<input class="input" type="time" id="hw-due-time" />' +
        "</div></div>" +
        '<div class="field"><label>要求 / 备注</label><textarea class="textarea" id="hw-desc" placeholder="作业要求、提交方式…"></textarea></div>' +
        '<div class="field"><label>链接（可空）</label><input class="input" id="hw-url" placeholder="https://elearning.fudan.edu.cn/…" /></div>' +
        '<div id="hw-extra"></div>';
      body.querySelector("#hw-course").value = cur.course;
      body.querySelector("#hw-title").value = cur.title;
      body.querySelector("#hw-due").value = cur.due ? cur.due.slice(0, 10) : "";
      body.querySelector("#hw-due-time").value = cur.dueTime || "23:59";
      body.querySelector("#hw-desc").value = cur.desc || "";
      body.querySelector("#hw-url").value = cur.url || "";

      const extra = body.querySelector("#hw-extra");
      if (!isNew) {
        extra.innerHTML =
          '<div class="btn-row" style="margin-top:6px">' +
            '<button class="btn soft" id="hw-cal">' + icon("calendar") + "写入日历</button>" +
            '<button class="btn ghost" id="hw-ai">' + icon("sparkles") + "AI 摘要</button>" +
          "</div>" +
          '<button class="btn ghost" id="hw-del" style="width:100%;margin-top:10px;color:var(--danger)">' + icon("trash") + "删除作业</button>";
        body.querySelector("#hw-cal").onclick = async () => {
          if (!cur.due) { toast("先填截止日期", "err"); return; }
          await writeToCalendar(cur);
          api.close();
        };
        body.querySelector("#hw-ai").onclick = () => {
          api.close();
          navigate("ai", { ask: "帮我总结这份作业的要求，列出要做的事和截止时间。作业信息：" + [cur.course, cur.title, cur.due, cur.desc].filter(Boolean).join(" / ") });
        };
        body.querySelector("#hw-del").onclick = async () => {
          const ok = await confirmDialog({ title: "删除作业", message: "删除后无法恢复。", ok: "删除", danger: true });
          if (!ok) return;
          await db.del("homework", cur.id);
          toast("已删除"); api.close(); refresh();
        };
      }

      const foot = api.foot;
      foot.innerHTML = "";
      const save = el('<button class="btn primary">' + (isNew ? "添加" : "保存") + "</button>");
      save.onclick = async () => {
        const title = body.querySelector("#hw-title").value.trim();
        if (!title) { toast("先写作业标题", "err"); return; }
        const dueDate = body.querySelector("#hw-due").value;
        const row = {
          ...cur,
          course: body.querySelector("#hw-course").value.trim(),
          title,
          due: dueDate ? dueDate + (body.querySelector("#hw-due-time").value ? " " + body.querySelector("#hw-due-time").value : "") : "",
          dueTime: body.querySelector("#hw-due-time").value,
          desc: body.querySelector("#hw-desc").value.trim(),
          url: body.querySelector("#hw-url").value.trim(),
          updatedAt: Date.now(),
        };
        await db.put("homework", row);
        toast(isNew ? "作业已添加" : "已保存", "ok");
        api.close();
        refresh();
      };
      foot.appendChild(save);
    },
  });
}

async function writeToCalendar(h) {
  const title = "作业截止：" + (h.course ? h.course + " · " : "") + h.title;
  const events = await db.all("events");
  if (events.some((e) => e.title === title && e.date === h.due.slice(0, 10))) {
    toast("日历里已经有这条了");
    return;
  }
  const time = h.dueTime || "23:59";
  await db.put("events", {
    id: uid(), title, description: h.desc || ("来自作业：" + h.title),
    date: h.due.slice(0, 10), start: time, end: "", location: "",
    color: "rose", remind: 30, repeat: "", repeatSkip: [], repeatUntil: "",
    done: 0, notified: "", createdAt: Date.now(), updatedAt: Date.now(),
  });
  toast("已写入日历（提前 30 分钟提醒）", "ok");
  window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "events" } }));
}

async function refresh() {
  items = await db.all("homework");
  paint();
}

async function importFromCalendar() {
  const events = await db.all("events");
  const candidates = events.filter((e) => e.title.startsWith("作业截止：") || /作业|论文|报告/.test(e.title));
  if (!candidates.length) { toast("日历里没有像作业的日程"); return; }
  const pick = await actionSheet(candidates.slice(0, 8).map((e) => ({
    label: e.date + " · " + e.title, value: e.id,
  })), "从日历导入作业");
  if (!pick) return;
  const ev = candidates.find((e) => e.id === pick);
  if (!ev) return;
  await db.put("homework", {
    id: uid(), course: "", title: ev.title.replace(/^作业截止：/, ""),
    desc: ev.description || "", due: ev.date + " " + (ev.start || "23:59"),
    dueTime: ev.start || "23:59", status: "todo", url: "", createdAt: Date.now(), updatedAt: Date.now(),
  });
  toast("已导入", "ok");
  refresh();
}
