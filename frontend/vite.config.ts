import { defineConfig } from "vite";

const FRONTEND_PORT = 3060;
const ENGINE_PORT = 8060;

export default defineConfig({
  root: ".",
  publicDir: "public",
  server: {
    port: FRONTEND_PORT,
    host: false,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${ENGINE_PORT}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: FRONTEND_PORT + 1,
    host: false,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${ENGINE_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2022",
  },
});
