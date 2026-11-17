// 把 dist/ 準備成可以直接上傳到 Vercel 的靜態網站（2026-11-17）。
//
// 為什麼不用 `vercel build` + `vercel deploy --prebuilt`：`vercel build` 在 Windows 要建立符號連結，
// 沒有系統管理員權限會失敗（EPERM）。所以改成「本機 npm run build → 上傳 dist/」：
// Vercel 那邊不建置，只照 dist/vercel.json 套用安全標頭後提供檔案。
//
// 用法（在 packages/camp-host）：
//   npm run build
//   node scripts/prepare-deploy.mjs
//   npx vercel deploy dist --prod
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

if (!existsSync("dist/index.html")) throw new Error("找不到 dist/index.html，請先執行 npm run build");
if (!existsSync(".vercel/project.json")) throw new Error("找不到 .vercel/project.json，請先執行 npx vercel link");

// 標頭與正式設定同一份（vercel.json），只拿掉建置設定：dist/ 已經是成品。
const { buildCommand, outputDirectory, ...rest } = JSON.parse(readFileSync("vercel.json", "utf8"));
writeFileSync("dist/vercel.json", JSON.stringify({ ...rest, framework: null, buildCommand: null, installCommand: null }, null, 2) + "\n");

mkdirSync("dist/.vercel", { recursive: true });
copyFileSync(".vercel/project.json", "dist/.vercel/project.json");
console.log("dist/ 已準備好：vercel.json（安全標頭）與 .vercel/project.json（專案連結）。");
