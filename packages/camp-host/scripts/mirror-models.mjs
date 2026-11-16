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

/** TensorFlow.js 模型（tfhub 或 Google Cloud Storage）。tfhub 的網址結尾要加 ?tfjs-format=file 才會拿到檔案本身；GCS 會忽略這個參數。 */
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
  {
    dir: "models/handdetector",
    source: "https://tfhub.dev/mediapipe/tfjs-model/handdetector/1/default/1",
    files: {
      "model.json": "f1a675f1832f3054e4698e34b8c42e4794b1154f351f17789e03bd72350e9407",
      "group1-shard1of2.bin": "007a65e43836907709b136066443f279d336f13a530965a2005eb7eb79f30f4a",
      "group1-shard2of2.bin": "0fc96525c4e7a3596d088ac3a6e9324f8f38691b27515f118411de593802cc7d",
    },
  },
  {
    dir: "models/handskeleton",
    source: "https://tfhub.dev/mediapipe/tfjs-model/handskeleton/1/default/1",
    files: {
      "model.json": "759a0bc18afbbcc6deeecb3025b917ba07c6793ef223842abd87b0977d8a3e4b",
      "group1-shard1of2.bin": "f7d29046066feecd4691c5b23f0ecaad46880ab17db861bada6aad7a9abc22dc",
      "group1-shard2of2.bin": "f5bde06bf1c292edf605f4c29549aadb1f0c750f0cc1d0a360ba584b07adb84d",
      "anchors.json": "2313768e67c799cbd715ebc18ceef32e87786f1e6ee5df9dab352bb82147ee83",
    },
  },
  {
    // ml5 PoseNet 的預設：MobileNetV1、multiplier 0.75、quantBytes 2、outputStride 16
    dir: "models/posenet",
    source: "https://storage.googleapis.com/tfjs-models/savedmodel/posenet/mobilenet/quant2/075",
    files: {
      "model-stride16.json": "38b860de18e6e48ff274477c2b7207ade6f24fa0ca5509319fa01458ca5884d7",
      "group1-shard1of1.bin": "fa9f00dab1468f722f497c06f5c29f60ee3ad9eb1fa81499d0eb16d99290cbd8",
    },
  },
  {
    // Teachable Machine（姿態）：@teachablemachine/pose 用 PoseNet MobileNetV1、0.75、quantBytes 4（float）
    dir: "models/posenet-float",
    source: "https://storage.googleapis.com/tfjs-models/savedmodel/posenet/mobilenet/float/075",
    files: {
      "model-stride16.json": "dd63bf2d3b983e8c80020749f135164beda00a33374c8a7be230b9598f24f798",
      "group1-shard1of2.bin": "ce6afc62f89782d43139fab76c641b281a82dee2cd2759aa036c4b28aea16439",
      "group1-shard2of2.bin": "2a35b8cfb86eb50928931e03dc30c0972fdd375f148b177ee40676b81a17692d",
    },
  },
  {
    // 影像訓練器：ml5 特徵擷取器（MobileNet v1、alpha 0.25）。layers 模型用來擷取特徵，graph 模型 ml5 也會載入
    dir: "models/mobilenet-layers",
    source: "https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.25_224",
    files: {
      "model.json": "d14c680e069d74143e3771c291cf3fd153ee88b6ea9ee44bfaf84e2008ded44e",
      "group1-shard1of1": "edabf35aefbb81c92764cbfff6319c77376bfc36febff8fcda7af703d2b2d6aa",
      "group2-shard1of1": "2c1e2fdf2b434592a87f2473ee63eaadec9b9992274bf894bf9022aa62a4b295",
      "group3-shard1of1": "5c6dc065b191c2d25817b1363962b3750b10f12d1da45503d4f2b35f63828b44",
      "group4-shard1of1": "6d0bdad897777f9eff6645374b533887cc446ebbb775ee9c4fb6ba3651c39be8",
      "group5-shard1of1": "b0d70f6c3943ff882969ee42494650cbad05b6358ae4dd7fb767052e2c8d61a9",
      "group6-shard1of1": "b1670b847b867f3375c5c28182f8dc7ec4cd5227e8a288e63c205057b4bcae06",
      "group7-shard1of1": "9449cf689bf0c590b8637e2d85cd66121af6e24ef23e327e1e9616e33c943ccf",
      "group8-shard1of1": "ff90f4c898656ab72f1b22c661527d33ea24c277e0ec41a694b796bc70bbef62",
      "group9-shard1of1": "619417b59fbc5c8b19c0103a1356d8c6cc2edbbacae04d61bd66d568ca44ca10",
      "group10-shard1of1": "56e538501e0a023c76eef09155492d06ac9b6c23e1ff740ce41b82b3c31d6e94",
      "group11-shard1of1": "5f089a0979fa68b7637bf26c51e866b6e08d2bad72e1a3e10dec081d551133e2",
      "group12-shard1of1": "47b68d00ca57c0b6e39fb9d39e4eb7dabf0b99ec38c49bc45e1397cea329fe46",
      "group13-shard1of1": "7b7c74cb5c301312a7c62c9eeb4fdc8c5c57880f58268c32c1060bae7452a93a",
      "group14-shard1of1": "1403fb88a00a1ee465631c6fdb8eec0d532a7b4d9e946f03ae6848304bf41082",
      "group15-shard1of1": "31fc5c67b4f0f32a86069c90f5098988fb4b6b9d6e837cde9318bf82c6ace283",
      "group16-shard1of1": "45befac068de20c8d151a3cba9f7d09a0d4e0fd23e786a78615a98eb0800b1a5",
      "group17-shard1of1": "268bfbd17bd9333c3867de58d15c359f8211111b47130361fc078ad85c838c17",
      "group18-shard1of1": "fd6b29d8b2c4b14cb68b23c5b065c98cb5bf5b1bb591823fabbbf59a5699dcb3",
      "group19-shard1of1": "65f3ba8b805628857d9305ddec4b07b2ba3c578a7740d10791384a3ff5574ad1",
      "group20-shard1of1": "7050469756997f7f39f29123924e4d570740c865b9778102b4b5e860a60d2445",
      "group21-shard1of1": "b7ac12c0857e6de96b0973df3f68bfe0d49a24f2408c120fe698e4b892bf00cc",
      "group22-shard1of1": "5206911ca627537095d3b4f6389df6d3d6397a7faee336e67215b71a691c8ae9",
      "group23-shard1of1": "67a89784137ea9720e6c5ee9d70113933e087100f3f0df3eebefda9dc11c72a3",
      "group24-shard1of1": "c6fec2526a167ae899ad6bc96a27a4e525ef5e94da0c23a37465ecae266afd4d",
      "group25-shard1of1": "8dd9917bfc71ffec7d2f9b8a74a47b59fbc1f7d03e18c1a7996fb64cca244cb7",
      "group26-shard1of1": "93fd2a5988cb4578cf6ccb7f65eaf838621307923b726f4d34a9a69c82aa7835",
      "group27-shard1of1": "71a4b8f17edb37acb78b0acd6d666f247fbd41588528f84c74514054274f91bb",
      "group28-shard1of1": "88a53e2fe1d619390a3783149161113d6c792262133bd07d2a7ee0f0c8176e00",
      "group29-shard1of1": "f047ff48ce2829fd9c10bbae13c9443d77d2450c3373b47ca3f8b837f0012789",
      "group30-shard1of1": "165a39308c2b2db017e4e1c70d70014da8e7b2057d214a92b87ccd0aa8ecb8da",
      "group31-shard1of1": "be3ae0501d536d6b8ebc9848b978062772dff56591473a3d593cdd23bad8557b",
      "group32-shard1of1": "6bab02eafbdb5743a75b8a18f4676f0206b9b2ddfe58bb752b3624fef4570bee",
      "group33-shard1of1": "53adf89e30f46c58b4f2d692e3f74901346e0d9220abd42910069aa04b8a2ec6",
      "group34-shard1of1": "1f43e3baf5e0c002b161da703a15c05f331e6369da2ec24d9427365052e8ea02",
      "group35-shard1of1": "1277abc3755440b0589d7c19630c48ff996c7ed64cfdf29c9dfcc539db5788ea",
      "group36-shard1of1": "fa47f3541eea153174b3159d5fe2d376de467a49925870fea3804f31253ca227",
      "group37-shard1of1": "00ede3172b77a23b95371ea79f0480b6a46c296c3c875732beeb213278223c4e",
      "group38-shard1of1": "f9cda80d267ab6ef2c657afed93c1f0342db0a14c8c61ee8036dcd6ba04cf526",
      "group39-shard1of1": "0a9369be8b5dfb7f25eb782ca9d57bcf5c6018a60c5789975b7c802d2e9a8033",
      "group40-shard1of1": "e29621b35ebb0a35d22a11ae5b1bb070c0526577bd92ed9c2cbf0a63f055b4e1",
      "group41-shard1of1": "ac7417eb2b88016e6aed832a0cb61369e6457a7bbfef1167c22e49e00cf2a315",
      "group42-shard1of1": "7c292473c55e234091f8d99422743779a5a9e8f91d49c90ef9a77432290299d4",
      "group43-shard1of1": "74ec361a7398c2510727c6a513f6e79a407aa5332f8a1b2b8c992b445a108c98",
      "group44-shard1of1": "ea7b1678a5eecbbec96a7aacb5577f54df43f71be8ee2480b5942e717488f6de",
      "group45-shard1of1": "56f8ed19d60e630e7a528adc90bc7215991c42606435be271ba2e1301317f353",
      "group46-shard1of1": "32124cabcfdc5859466b6af656c8467fb4a48bdaac6382ab5b5db015565a09b4",
      "group47-shard1of1": "34fa5b0e22b0d998a9fe503fb921cf947c1f163d4b70017801cb6e900b1ab6d5",
      "group48-shard1of1": "b2be37c058ad99a6bd51ca54884b3dfe278b33e5372d470ba8f4a8859139fb7d",
      "group49-shard1of1": "59fa80185c94b52f85592b65de71563a8acca6ed5cb94c4ae8f2a02ec97e808c",
      "group50-shard1of1": "530f049c43b9f31f2e4aa2663723a5090cdec42f243833f348acb400a386311c",
      "group51-shard1of1": "1d202ecdbb7d48aa152ccb8cc34b24812f774038802f80a3e8889b3ab3b48599",
      "group52-shard1of1": "ce01c0edb4584d50dddaf7d0deba4ab156b43176c8810a92b21ab0b239cecfba",
      "group53-shard1of1": "6cca55e52e39b97b87d67a21180fba53e51d3e2cdbb157ebfa09530836119364",
      "group54-shard1of1": "63f0914ba3f4cd773e2b4eae2235ab43cb325b1ab21f1dc7325160b5b6aa0f3b",
      "group55-shard1of1": "a762f7d6c962f43b16e8ef3fede568eac7f6fb2941af14cb25ef9a211e50f704",
    },
  },
  {
    dir: "models/mobilenet-graph",
    source: "https://tfhub.dev/google/imagenet/mobilenet_v1_025_224/classification/1",
    files: {
      "model.json": "3bc53d90df1172878d0dbf11602a56d1725639682895ef6d3ee63a662b5138f7",
      "group1-shard1of1.bin": "639c16be6dac70b2350586f503a379396807dcb2df840685bfafe6af2d8ec30f",
    },
  },
];

/**
 * 建置時從 jsDelivr 下載的函式庫（固定版本＋雜湊）。執行時由本網域提供，不連 CDN。
 * Teachable Machine（姿態）原版在執行時從 cdn.jsdelivr.net 載入這兩個檔案（SPEC 7.3.4：供應鏈風險，改為自架）。
 */
const DOWNLOADED_VENDOR_FILES = [
  {
    url: "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.3.1/dist/tf.min.js",
    to: "vendor/tfjs-1.3.1.min.js",
    sha256: "cacc44b288b5e3362fe388e8058cdb9027e54018725c373d4c8d4831c1cbbd0f",
  },
  {
    url: "https://cdn.jsdelivr.net/npm/@teachablemachine/pose@0.8.6/dist/teachablemachine-pose.min.js",
    to: "vendor/teachablemachine-pose-0.8.6.min.js",
    sha256: "eb956a201ae97447bc3febe20f05e84e8edad98a5d1a41c01533bcae989c1849",
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

for (const v of DOWNLOADED_VENDOR_FILES) {
  const file = join(pub, v.to);
  if (upToDate(file, v.sha256)) {
    console.log(`略過 ${v.to}（已存在）`);
    continue;
  }
  try {
    const res = await fetch(v.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    check(v.to, buf, v.sha256);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, buf);
    console.log(`下載 ${v.to}（${buf.length} bytes）`);
  } catch (e) {
    rmSync(file, { force: true });
    console.error(`失敗 ${v.to}：${e.message}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("模型與函式庫已就緒");
