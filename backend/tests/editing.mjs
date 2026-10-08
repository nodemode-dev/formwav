import { join } from "node:path";
import { pathToFileURL } from "node:url";

// node editing.mjs <frontend>: reads [{ doc, fn, args }] on stdin, runs engine/editing.ts's (or grid.ts's, timebase.ts's,
// midi.ts's or audio/notes.ts's) fn(doc, ...args) (fn(...args) for a null doc; for fn "apply", the command args[0]) and
// applies the command it returns as the engine dispatches one, then writes [{ value, after }]: the function's result
// (bytes as a list) and the session after it. An argument { $set: [...] } arrives as a Set (a pick of notes).
const frontend = process.argv[2];
const { createServer } = await import(pathToFileURL(join(frontend, "node_modules", "vite", "dist", "node", "index.js")).href);
const server = await createServer({
  root: frontend,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const { applyCommand, followClips } = await server.ssrLoadModule("/src/engine/document.ts");
  const editing = { ...(await server.ssrLoadModule("/src/engine/editing.ts")), ...(await server.ssrLoadModule("/src/engine/grid.ts")), ...(await server.ssrLoadModule("/src/engine/timebase.ts")), ...(await server.ssrLoadModule("/src/engine/midi.ts")), ...(await server.ssrLoadModule("/src/audio/notes.ts")) };
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const revive = (a) => (a && typeof a === "object" && Array.isArray(a.$set) ? new Set(a.$set) : a);
  const out = JSON.parse(Buffer.concat(chunks).toString("utf8")).map(({ doc, fn, args }) => {
    args = args.map(revive);
    const raw = fn === "apply" ? args[0] : doc === null ? editing[fn](...args) : editing[fn](doc, ...args);
    const value = raw instanceof Uint8Array ? Array.from(raw) : raw;
    const command = value && typeof value === "object" && typeof value.type === "string" ? value : null;
    let n = 0;
    const after = command ? followClips(doc, applyCommand(doc, command, () => `new${n++}`)) : doc;
    return { value, after };
  });
  process.stdout.write(JSON.stringify(out));
} finally {
  await server.close();
}
