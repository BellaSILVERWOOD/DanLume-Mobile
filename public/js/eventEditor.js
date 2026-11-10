/* 日程编辑器（新建 / 编辑 / 删除重复实例） */
import { db, updateRow } from "./db.js";
import { openSheet, toast, actionSheet, confirmDialog, esc, qs, el } from "./ui.js";
import { icon } from "./icons.js";
import {
  EVENT_COLORS, COLOR_ORDER, REMIND_OPTIONS, REPEAT_OPTIONS, dateStr, addDays,
  uid, fmtDateCN, weekdayCN, repeatLabel, remindLabel,
} from "./util.js";

export async function openEventActions(ev, instanceDate) {
  if (!ev) return;
  const choice = await actionSheet([
    { label: "编辑日程", value: "edit", icon: "edit" },
    { label: "删除日程", value: "delete", icon: "trash", danger: true },
  ], ev.title || "日程");
  if (!choice) return;
  if (choice === "edit") {
    openEventEditor({ event: { ...ev, instanceDate: instanceDate || ev.date } });
    return;
  }
  if (choice === "delete") {
    const isSeries = !!ev.repeat;
    const ok = await confirmDialog({
      title: "删除日程",
      message: "「" + (ev.title || "这条日程") + "」会被删除" +
        (isSeries ? "；这是重复日程，会删除整个系列" : "") +
        (ev.source === "fudan" ? "。这是课表同步的课程，下次同步会重新出现" : "") +
        "，无法恢复。",
      ok: "删除", danger: true,
    });
    if (!ok) return;
    await db.del("events", ev.id);
    toast("已删除", "ok");
    window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "events" } }));
  }
}

export function openEventEditor({ event = null, date = null, onSaved = null } = {}) {
  const isNew = !event;
  let current = event ? { ...event } : {
    id: uid(),
    title: "",
    description: "",
    date: date || dateStr(),
    start: "09:00",
    end: "10:00",
    location: "",
    color: "violet",
    remind: 15,
    repeat: "",
    repeatSkip: [],
    repeatUntil: "",
    done: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  let instanceDate = event && event.instanceDate ? event.instanceDate : current.date;
  const isRecurringInstance = !!(event && event.repeat && event.instanceDate);

  openSheet({
    title: isNew ? "新建日程" : "编辑日程",
    full: true,
    footer: true,
    build(body, api) {
      body.innerHTML =
        '<div class="field"><label>标题</label><input class="input" id="ev-title" placeholder="要做什么？" /></div>' +
        '<div class="field"><label>日期</label><div class="input-row">' +
          '<input class="input" id="ev-date" type="date" />' +
          '<div class="chips" style="flex:0 0 auto;gap:6px">' +
            '<button class="chip" data-quick="0">今天</button>' +
            '<button class="chip" data-quick="1">明天</button>' +
          "</div>" +
        "</div></div>" +
        '<div class="field"><label>时间</label><div class="input-row">' +
          '<input class="input" id="ev-start" type="time" />' +
          '<input class="input" id="ev-end" type="time" />' +
        "</div></div>" +
        '<div class="field"><label>地点</label><input class="input" id="ev-loc" placeholder="可选，例如 三教 3108" /></div>' +
        '<div class="field"><label>颜色</label><div class="chips" id="ev-colors"></div></div>' +
        '<div class="field"><label>提醒</label><select class="input" id="ev-remind"></select></div>' +
        '<div class="field"><label>重复</label><div class="input-row"><select class="input" id="ev-repeat"></select>' +
          '<input class="input" id="ev-until" type="date" title="重复到哪天（可空）" style="max-width:140px" />' +
        "</div></div>" +
        '<div class="field"><label>备注</label><textarea class="textarea" id="ev-desc" placeholder="补充说明（可选）"></textarea></div>' +
        '<div id="ev-extra"></div>';

      const $ = (id) => qs("#" + id, body);
      $("ev-title").value = current.title;
      $("ev-date").value = current.date;
      $("ev-start").value = current.start || "09:00";
      $("ev-end").value = current.end || "";
      $("ev-loc").value = current.location || "";
      $("ev-desc").value = current.description || "";
      $("ev-remind").innerHTML = REMIND_OPTIONS.map((o) =>
        '<option value="' + (o.value === null ? "" : o.value) + '">' + o.label + "</option>").join("");
      $("ev-remind").value = current.remind == null ? "" : String(current.remind);
      $("ev-repeat").innerHTML = REPEAT_OPTIONS.map((o) =>
        '<option value="' + o.value + '">' + o.label + "</option>").join("");
      $("ev-repeat").value = current.repeat || "";
      $("ev-until").value = current.repeatUntil || "";
      $("ev-until").style.display = current.repeat ? "" : "none";

      // 颜色
      const colors = $("ev-colors");
      COLOR_ORDER.forEach((key) => {
        const c = EVENT_COLORS[key];
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "color-dot" + (current.color === key ? " on" : "");
        dot.style.setProperty("--c", c.value);
        dot.title = c.label;
        dot.onclick = () => {
          current.color = key;
          colors.querySelectorAll(".color-dot").forEach((n) => n.classList.remove("on"));
          dot.classList.add("on");
        };
        colors.appendChild(dot);
      });

      $("ev-repeat").addEventListener("change", (e) => {
        $("ev-until").style.display = e.target.value ? "" : "none";
      });

      body.querySelectorAll("[data-quick]").forEach((b) => {
        b.onclick = () => { $("ev-date").value = addDays(dateStr(), Number(b.dataset.quick)); };
      });

      if (isRecurringInstance) {
        const extra = $("ev-extra");
        extra.innerHTML = '<div class="card flat tight" style="margin-bottom:6px"><div class="small muted">这是一条重复日程的实例（' +
          fmtDateCN(instanceDate) + "），保存时只影响这一条，或选择「整个系列」。</div></div>";
      }

      const foot = api.foot;
      if (foot) {
        foot.innerHTML = "";
        if (!isNew) {
          const del = el('<button class="btn danger" style="flex:0 0 auto;width:52px">' + icon("trash") + "</button>");
          del.onclick = async () => { await deleteEvent(current, instanceDate, api, isRecurringInstance); };
          foot.appendChild(del);
        }
        const save = el('<button class="btn primary">' + (isNew ? "添加日程" : "保存") + "</button>");
        save.onclick = async () => {
          const title = $("ev-title").value.trim();
          if (!title) { toast("先写一个标题", "err"); $("ev-title").focus(); return; }
          const payload = {
            ...current,
            title,
            date: $("ev-date").value || dateStr(),
            start: $("ev-start").value || "09:00",
            end: $("ev-end").value || "",
            location: $("ev-loc").value.trim(),
            description: $("ev-desc").value.trim(),
            remind: $("ev-remind").value === "" ? null : Number($("ev-remind").value),
            repeat: $("ev-repeat").value,
            repeatUntil: $("ev-repeat").value ? ($("ev-until").value || "") : "",
            updatedAt: Date.now(),
          };
          if (isNew) {
            delete payload.instanceDate;
            await db.put("events", payload);
          } else {
            const stored = await db.get("events", current.id);
            if (!stored) { toast("这条日程已经不在了", "err"); return; }
            await db.put("events", { ...stored, ...payload, repeatSkip: payload.repeatSkip || [], instanceDate: undefined });
          }
          toast(isNew ? "日程已添加" : "已保存", "ok");
          api.close();
          window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "events" } }));
          if (onSaved) onSaved(payload);
        };
        foot.appendChild(save);
      }
    },
  });
}

async function deleteEvent(ev, instanceDate, api, isRecurring) {
  if (!isRecurring) {
    const ok = await confirmDialog({ title: "删除日程", message: "「" + ev.title + "」会被删除，且无法恢复。", ok: "删除", danger: true });
    if (!ok) return;
    await db.del("events", ev.id);
    toast("已删除");
    api.close();
    window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "events" } }));
    return;
  }
  const choice = await actionSheet([
    { label: "删除整个重复日程（所有日期）", value: "all", icon: "trash", danger: true },
    { label: "只删除这一次", value: "one", icon: "calendar" },
    { label: "删除这次及以后", value: "future", icon: "layers" },
  ], "删除重复日程");
  if (!choice) return;
  const stored = await db.get("events", ev.id);
  if (!stored) { toast("这条日程已经不在了", "err"); return; }
  if (choice === "one") {
    const skip = new Set(stored.repeatSkip || []);
    skip.add(instanceDate);
    await db.put("events", { ...stored, repeatSkip: Array.from(skip), updatedAt: Date.now() });
  } else if (choice === "future") {
    await db.put("events", { ...stored, repeatUntil: addDays(instanceDate, -1), updatedAt: Date.now() });
  } else {
    await db.del("events", ev.id);
  }
  toast("已删除");
  api.close();
  window.dispatchEvent(new CustomEvent("danlume:data", { detail: { store: "events" } }));
}
