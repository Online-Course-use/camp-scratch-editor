import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAMP_CONNECT_SRC } from "../vite.config";

/**
 * 安全標頭寫在兩個地方：vercel.json（正式）與 vite.config.ts（本機）。
 * 兩邊不一致時，本機測得過、正式環境卻被 CSP 擋住（2026-11-16 文字轉語音就是這樣發現的）。
 */
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const csp: string = vercel.headers[0].headers.find((h: { key: string }) => h.key === "Content-Security-Policy").value;
const connectSrc = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith("connect-src "))!.slice("connect-src ".length);

describe("安全標頭（SPEC 8.4）", () => {
  it("vercel.json 的 connect-src 與 vite.config.ts 相同", () => {
    expect(connectSrc).toBe(CAMP_CONNECT_SRC);
  });

  it("connect-src 只列允許的外部網域，沒有萬用字元", () => {
    const external = connectSrc.split(" ").filter((s) => s.startsWith("http"));
    expect(external.sort()).toEqual([
      "https://storage.googleapis.com",
      "https://synthesis-service.scratch.mit.edu",
      "https://teachablemachine.withgoogle.com",
    ]);
    expect(connectSrc).not.toContain("*");
  });

  it("只允許營隊網站嵌入", () => {
    expect(csp).toContain("frame-ancestors https://camp.fantageeks.com;");
  });
});
