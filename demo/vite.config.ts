const PORT = 3070;

const classicScripts = {
  name: "classic-scripts-for-file-protocol",
  enforce: "post" as const,
  transformIndexHtml(html: string): string {
    return html
      .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>')
      .replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, '<link rel="stylesheet" href="$1">');
  },
};

export default {
  root: new URL("./src", import.meta.url).pathname,
  base: "./",
  publicDir: false,
  plugins: [classicScripts],
  resolve: { alias: { "@fontsource": new URL("../frontend/node_modules/@fontsource", import.meta.url).pathname } },
  server: { host: false, port: PORT, strictPort: true, fs: { allow: [".."] } },
  preview: { host: false, port: PORT + 1, strictPort: true },
  build: {
    outDir: "..",
    emptyOutDir: false,
    assetsDir: "assets",
    target: "es2022",
    sourcemap: false,
    assetsInlineLimit: 100000,
    cssCodeSplit: false,
    rollupOptions: { output: { format: "iife", entryFileNames: "assets/demo.js", assetFileNames: "assets/[name][extname]" } },
  },
};
