/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import pkg from "./package.json" with { type: "json" };
import guiPkg from "../scratch-gui/package.json" with { type: "json" };

/**
 * 營隊部署的安全標頭（SPEC 8.4）。本機開發與 vercel.json 用**同一份政策**（本機多允許 ws: 給 Vite 熱更新），
 * 才能在本機就驗證到「被別的網站嵌入時無法運作」與「模型載入被 CSP 擋住」。
 *
 * connect-src 只有兩個外部網域，**不開萬用字元**：Teachable Machine 的模型與函式庫。
 * 其餘 AI 模型一律由本網域自架（`/models/…`），所以不需要連外。
 */
export const CAMP_CONNECT_SRC = "'self' blob: data: https://storage.googleapis.com https://teachablemachine.withgoogle.com";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const origins = (env.VITE_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const headers = {
    "Content-Security-Policy": `frame-ancestors ${origins.join(" ") || "'none'"}; connect-src ${CAMP_CONNECT_SRC} ws:; object-src 'none'; base-uri 'self'`,
    // 不得封鎖鏡頭、麥克風與序列埠（Arduino 的 WebSerial）；嵌入頁要用 allow 屬性授權才用得到。
    "Permissions-Policy": "camera=(self), microphone=(self), serial=(self)",
  };

  return {
    define: { __EDITOR_VERSION__: JSON.stringify(`${pkg.version}+scratch-gui.${guiPkg.version}`) },
    // 營隊網站在 3000，編輯器外殼在 5174，測試用的假網站（harness）在 5175。
    // forwardConsole：Vite 8 在 AI 助理啟動的伺服器上會自動把瀏覽器的警告全部轉送回伺服器；
    // 編輯器（scratch-blocks、TensorFlow.js）警告很多，曾讓伺服器卡在滿載、檔案傳很慢（2026-11-10），所以明確關閉。
    // watch.ignored：public/ 裡是重建時整批複製的 scratch-gui 產物、素材庫、AI 模型與韌體（上萬個檔案），
    // 不需要熱更新；不監看它們，避免每次重建後伺服器忙著處理檔案變動、傳檔變得很慢（2026-11-11）。
    server: {
      port: 5174,
      strictPort: true,
      headers,
      forwardConsole: false,
      watch: { ignored: ["**/public/**", "**/dist/**", "**/firmware/**"] },
    },
    preview: { port: 5174, strictPort: true, headers },
    build: { chunkSizeWarningLimit: 1000 },
    test: { environment: "node", include: ["tests/**/*.test.ts"] },
  };
});
