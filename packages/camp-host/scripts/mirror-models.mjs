// 把 AI 擴展需要的模型檔與函式庫放到 public/，由本網域提供（SPEC 7.3.4、8.2）。
//
// 為什麼：編輯器的安全標頭不允許連到模型的原始來源（tfhub.dev／Kaggle），而且上游來源不穩定
// （tfhub 現在轉址到有時效的簽名網址）。改為建置時下載一次、核對雜湊，執行時只從本網域取用。
// 函式庫（ml5）也放在這裡而不是打包進 scratch-gui：只有學員真的加入擴展時才下載（延遲載入）。
//
// 已存在且雜湊正確的檔案會略過，可重複執行。任何一個檔案的雜湊不符就失敗，不留下不明的檔案。
// 用法：npm run mirror-models
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** 從 tfhub 下載的 TensorFlow.js 模型。網址結尾要加 ?tfjs-format=file 才會拿到檔案本身。 */
const TFHUB_MODELS = [
  {
    dir: "models/facemesh",
    source: "https://tfhub.dev/mediapipe/tfjs-model/facemesh/1/default/1",
    files: {
      "model.json": "c922985d95e101e7fe56576a9a00366c72d3fab3604ce371cc9d85394abda99c",
      "group1-shard1of1.bin": "f4a7075c1fff12ceafd2cd6fc000a464da90b1e0c35236971ed5bb3b343366cb",
    },
  },
  {
    dir: "models/blazeface",
    source: "https://tfhub.dev/tensorflow/tfjs-model/blazeface/1/default/1",
    files: {
      "model.json": "7b6bb6f35e5a7899232de51dda8bf514ef9664ca7ec58388c9fecc088c883b58",
      "group1-shard1of1.bin": "60b481ab6c19352673cdb21e02e639f90883db1393ac52d07c7ea4e1e11cb2cd",
    },
  },
];

/** 從同一個倉庫已安裝的 npm 套件複製的函式庫（版本由根目錄的 package-lock.json 鎖定）。 */
const VENDOR_FILES = [
  {
    from: join(root, "..", "scratch-vm", "node_modules", "ml5", "dist", "ml5.min.js"),
    to: "vendor/ml5-0.12.2.min.js",
    sha256: "8906ded3234dd3792a2dcef790c1f27033f059313f8b85bc8f81e10420e8c346",
  },
];

const upToDate = (file, hash) => existsSync(file) && sha256(readFileSync(file)) === hash;

function check(name, buf, expected) {
  const actual = sha256(buf);
  if (actual !== expected) {
    throw new Error(`${name} 的雜湊不符（上游檔案可能被換過）\n  預期 ${expected}\n  實際 ${actual}`);
  }
}

let failed = false;

for (const model of TFHUB_MODELS) {
  const out = join(pub, model.dir);
  mkdirSync(out, { recursive: true });
  for (const [name, hash] of Object.entries(model.files)) {
    const file = join(out, name);
    if (upToDate(file, hash)) {
      console.log(`略過 ${model.dir}/${name}（已存在）`);
      continue;
    }
    try {
      const res = await fetch(`${model.source}/${name}?tfjs-format=file`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      check(`${model.dir}/${name}`, buf, hash);
      writeFileSync(file, buf);
      console.log(`下載 ${model.dir}/${name}（${buf.length} bytes）`);
    } catch (e) {
      rmSync(file, { force: true });
      console.error(`失敗 ${model.dir}/${name}：${e.message}`);
      failed = true;
    }
  }
}

for (const v of VENDOR_FILES) {
  const file = join(pub, v.to);
  if (upToDate(file, v.sha256)) {
    console.log(`略過 ${v.to}（已存在）`);
    continue;
  }
  try {
    if (!existsSync(v.from)) throw new Error(`找不到 ${v.from}，請先在倉庫根目錄 npm install --ignore-scripts`);
    const buf = readFileSync(v.from);
    check(v.to, buf, v.sha256);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, buf);
    console.log(`複製 ${v.to}（${buf.length} bytes）`);
  } catch (e) {
    console.error(`失敗 ${v.to}：${e.message}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("模型與函式庫已就緒");
