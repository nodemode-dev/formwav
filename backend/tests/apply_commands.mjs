import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The interface's own reducer (frontend/src/engine/document.ts) applied to documents for the engine's tests: stdin is
// [{ doc, commands }], stdout each document after its commands.
const frontend = process.argv[2];
const { createServer } = await import(pathToFileURL(join(frontend, "node_modules", "vite", "dist", "node", "index.js")).href);
const server = await createServer({ root: frontend, configFile: false, logLevel: "error", appType: "custom", server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { applyCommand } = await server.ssrLoadModule("/src/engine/document.ts");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let n = 0;
  const newId = () => `id${++n}`;
  const out = JSON.parse(Buffer.concat(chunks).toString("utf8")).map(({ doc, commands }) => commands.reduce((d, c) => applyCommand(d, c, newId), doc));
  process.stdout.write(JSON.stringify(out));
} finally {
  await server.close();
}
