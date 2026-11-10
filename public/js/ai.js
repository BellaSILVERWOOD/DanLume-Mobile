/* OpenAI 兼容接口：流式对话、思考、工具调用 */
import { getSetting } from "./db.js";
import { bridge } from "./api.js";

export function aiConfig() {
  return {
    base: (getSetting("apiBase", "") || "").trim().replace(/\/+$/, ""),
    key: (getSetting("apiKey") || "").trim(),
    model: (getSetting("apiModel", "") || "").trim(),
    effort: getSetting("apiEffort", "high"),
  };
}

export function hasKey() {
  const c = aiConfig();
  return !!(c.base && c.key && c.model);
}

function endpoint() {
  const base = aiConfig().base;
  if (!base) throw new AIError("还没有配置服务地址，去「设置 → AI 设置」填写。", 0, "");
  if (/\/chat\/completions$/.test(base)) return base;
  return base + "/chat/completions";
}

// 优先走本机/电脑的转发接口，绕开浏览器对模型服务的 CORS/网络限制
async function proxyRequest(path, payload, signal) {
  const base = bridge() || location.origin;
  if (!base) return null;
  try {
    const resp = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (resp.status === 404) return null;
    return resp;
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    return null;
  }
}

export class AIError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function readableError(status, text) {
  let detail = text || "";
  try {
    const j = JSON.parse(text);
    if (j && j.error && j.error.message) detail = j.error.message;
  } catch (e) {}
  const map = {
    400: "请求格式不被接受",
    401: "访问密钥无效或已过期",
    402: "余额不足，请充值后再试",
    403: "没有权限使用这个模型",
    404: "服务地址不对（应该是 …/v1）",
    422: "参数不被接受",
    429: "请求太频繁，稍等一会儿",
    500: "服务端出错了，稍后重试",
    503: "服务暂时不可用，稍后重试",
  };
  return (map[status] || ("请求失败（HTTP " + status + "）")) + "：" + String(detail).slice(0, 300);
}

/** 流式对话：异步生成器，事件 {type:"delta"|"reasoning"|"tool"|"done"} */
export async function* streamChat({ messages, tools, model, effort, temperature = 1, signal, maxTokens }) {
  const cfg = aiConfig();
  if (!cfg.base) throw new AIError("还没有配置服务地址，去「设置 → AI 设置」填写。", 0, "");
  if (!cfg.key) throw new AIError("还没有填写访问密钥，去「设置 → AI 设置」填一个。", 0, "");
  if (!cfg.model) throw new AIError("还没有填写模型名，去「设置 → AI 设置」填写。", 0, "");
  const body = {
    model: model || cfg.model,
    messages,
    stream: true,
  };
  if (temperature != null) body.temperature = temperature;
  if (maxTokens) body.max_tokens = maxTokens;
  const wantEffort = effort || cfg.effort;
  if (wantEffort && wantEffort !== "off") body.reasoning_effort = wantEffort;
  if (tools && tools.length) { body.tools = tools; body.tool_choice = "auto"; }
  let resp = await proxyRequest("/api/ai/chat", {
    ...body, base: cfg.base, key: cfg.key,
  }, signal);
  if (!resp) {
    resp = await fetch(endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
      body: JSON.stringify(body),
      signal,
    });
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new AIError(readableError(resp.status, text), resp.status, text);
  }
  if (!resp.body) throw new AIError("当前浏览器不支持流式响应", 0, "");
  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  const toolCalls = new Map();
  let usage = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") { yield { type: "done", usage }; return; }
        let json;
        try { json = JSON.parse(data); } catch (e) { continue; }
        if (json.usage) usage = json.usage;
        const choice = json.choices && json.choices[0];
        if (!choice) continue;
        const delta = choice.delta || {};
        if (delta.reasoning_content) yield { type: "reasoning", text: delta.reasoning_content };
        if (delta.content) yield { type: "delta", text: delta.content };
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const i = tc.index ?? 0;
            if (!toolCalls.has(i)) toolCalls.set(i, { id: tc.id || "", name: "", arguments: "" });
            const cur = toolCalls.get(i);
            if (tc.id) cur.id = tc.id;
            if (tc.function) {
              if (tc.function.name) cur.name = tc.function.name;
              if (tc.function.arguments) cur.arguments += tc.function.arguments;
            }
          }
        }
        if (choice.finish_reason === "tool_calls") {
          yield { type: "tool", calls: Array.from(toolCalls.values()) };
        }
        if (choice.finish_reason && choice.finish_reason !== "tool_calls") {
          yield { type: "done", usage, finish: choice.finish_reason };
          return;
        }
      }
    }
  }
  yield { type: "done", usage };
}

/** 非流式：一次性拿到文本（摘要、周报等） */
export async function aiText(messages, { model, effort = "off", temperature = 0.7, maxTokens = 1200 } = {}) {
  const cfg = aiConfig();
  if (!cfg.base) throw new AIError("还没有配置服务地址，去「设置 → AI 设置」填写。", 0, "");
  if (!cfg.key) throw new AIError("还没有填写访问密钥，去「设置 → AI 设置」填一个。", 0, "");
  if (!cfg.model) throw new AIError("还没有填写模型名，去「设置 → AI 设置」填写。", 0, "");
  const body = { model: model || cfg.model, messages, stream: false, temperature };
  if (maxTokens) body.max_tokens = maxTokens;
  if (effort && effort !== "off") body.reasoning_effort = effort;
  let resp = await proxyRequest("/api/ai/chat", {
    ...body, base: cfg.base, key: cfg.key,
  });
  if (!resp) {
    resp = await fetch(endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
      body: JSON.stringify(body),
    });
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new AIError(readableError(resp.status, text), resp.status, text);
  }
  const json = await resp.json();
  const msg = json.choices && json.choices[0] && json.choices[0].message;
  return (msg && msg.content) || "";
}

export async function listModels() {
  const cfg = aiConfig();
  let resp = await proxyRequest("/api/ai/models", { base: cfg.base, key: cfg.key });
  if (!resp) {
    resp = await fetch(cfg.base + "/models", {
      headers: { Authorization: "Bearer " + cfg.key },
    });
  }
  if (!resp.ok) throw new AIError(readableError(resp.status, await resp.text()), resp.status, "");
  const json = await resp.json();
  return (json.data || []).map((m) => m.id);
}
