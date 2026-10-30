import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 本机预览复用运行中的服务，保留已打开页面引用的旧哈希资源。
  build: { emptyOutDir: false },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: process.env.TVBOX_DEV_HOST || "127.0.0.1",
    proxy: { "/api": "http://127.0.0.1:4781" },
  },
});
