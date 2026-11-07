import { readFileSync } from "node:fs";

const PORT = 3071;
const here = (p) => new URL(p, import.meta.url).pathname;

const themeBoot = {
  name: "theme-boot-from-demo-one",
  transformIndexHtml: {
    order: "pre",
    handler(html) {
      const src = readFileSync(here("../../demo/src/index.html"), "utf8");
      const boot = src.match(/<script>\s*\/\* stylized-nodemode[\s\S]*?<\/script>/);
      if (!boot) throw new Error("the theme boot script was not found in demo/src/index.html");
      return html.replace("<!--FW_THEME_BOOT-->", () => boot[0]);
    },
  },
};

const classicScripts = {
  name: "classic-scripts-for-file-protocol",
  enforce: "post",
  transformIndexHtml(html) {
    return html
      .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>')
      .replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, '<link rel="stylesheet" href="$1">');
  },
};

export default {
  root: here("./src"),
  base: "./",
  publicDir: false,
  plugins: [themeBoot, classicScripts],
  resolve: { alias: { "@fontsource": here("../../frontend/node_modules/@fontsource") } },
  server: { host: false, port: PORT, strictPort: true, fs: { allow: ["../.."] } },
  preview: { host: false, port: PORT + 1, strictPort: true },
  build: {
    outDir: here("./"),
    emptyOutDir: false,
    assetsDir: "assets",
    target: "es2022",
    sourcemap: false,
    assetsInlineLimit: 100000,
    cssCodeSplit: false,
    rollupOptions: { output: { format: "iife", entryFileNames: "assets/repair.js", assetFileNames: "assets/[name][extname]" } },
  },
};
