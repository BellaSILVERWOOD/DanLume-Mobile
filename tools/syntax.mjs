import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
const root = "D:\\AIagent-lmq\\DanLumeMobile\\public\\js";
const tmp = path.join(os.tmpdir(), "dl-chk.mjs");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
let bad = 0;
for (const file of walk(root).filter((f) => f.endsWith(".js"))) {
  fs.writeFileSync(tmp, fs.readFileSync(file));
  try { execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" }); }
  catch (e) {
    bad++;
    console.log("FAIL " + path.relative(root, file));
    console.log(String(e.stderr || "").split("\n").slice(0, 8).join("\n"));
  }
}
console.log(bad ? bad + " file(s) failed" : "all syntax ok");
