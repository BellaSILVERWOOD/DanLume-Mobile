import fs from "node:fs";
import yauzl from "yauzl";
import yazl from "yazl";

const [baseApk, dexFile, outApk] = process.argv.slice(2);
if (!baseApk || !dexFile || !outApk) {
  console.error("usage: node pack.mjs base.apk classes.dex out.apk");
  process.exit(1);
}

function readEntry(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      const chunks = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  });
}

function readBase() {
  return new Promise((resolve, reject) => {
    const items = [];
    yauzl.open(baseApk, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on("error", reject);
      zip.on("entry", async (entry) => {
        try {
          if (!/\/$/.test(entry.fileName)) {
            items.push({ entry, data: await readEntry(zip, entry) });
          }
          zip.readEntry();
        } catch (e) { reject(e); }
      });
      zip.on("end", () => resolve(items));
      zip.readEntry();
    });
  });
}

const items = await readBase();
const out = new yazl.ZipFile();
for (const { entry, data } of items) {
  const compress = entry.compressMethod === 8 && entry.fileName !== "resources.arsc";
  out.addBuffer(data, entry.fileName, { compress, mode: 0o100644 });
}
out.addBuffer(fs.readFileSync(dexFile), "classes.dex", { compress: true, mode: 0o100644 });
await new Promise((resolve, reject) => {
  const ws = fs.createWriteStream(outApk);
  out.outputStream.pipe(ws).on("close", resolve).on("error", reject);
  out.end();
});
console.log("packed", outApk, fs.statSync(outApk).size, "bytes,", items.length + 1, "entries");
