/* 把前端依赖从 node_modules 复制到 public/vendor */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nm = path.join(root, "node_modules");
const out = path.join(root, "public", "vendor");
fs.mkdirSync(path.join(out, "fonts"), { recursive: true });
const copies = [
  ["katex/dist/katex.min.js", "katex.min.js"],
  ["katex/dist/katex.min.css", "katex.min.css"],
  ["katex/dist/contrib/auto-render.min.js", "auto-render.min.js"],
  ["marked/lib/marked.umd.js", "marked.umd.js"],
  ["dompurify/dist/purify.min.js", "purify.min.js"],
];
for (const [from, to] of copies) {
  fs.copyFileSync(path.join(nm, from), path.join(out, to));
  console.log("copied", to);
}
const fontDir = path.join(nm, "katex/dist/fonts");
for (const f of fs.readdirSync(fontDir)) {
  fs.copyFileSync(path.join(fontDir, f), path.join(out, "fonts", f));
}
console.log("copied", fs.readdirSync(fontDir).length, "fonts");
