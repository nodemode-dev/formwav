import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The interface's engine functions called for the engine's tests: stdin is [{ module, fn, args }] (a module path under
// frontend/src, a function it exports, its arguments; an argument {"$map": doc} is that session's tempo map and
// {"$time": doc} its time context), stdout
// each call's result (a byte array as a list of numbers).
const frontend = process.argv[2];
const { createServer } = await import(pathToFileURL(join(frontend, "node_modules", "vite", "dist", "node", "index.js")).href);
const server = await createServer({ root: frontend, configFile: false, logLevel: "error", appType: "custom", server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const tempo = await server.ssrLoadModule("/src/engine/tempo.ts");
  const timebase = await server.ssrLoadModule("/src/engine/timebase.ts");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const out = [];
  for (const { module, fn, args } of JSON.parse(Buffer.concat(chunks).toString("utf8"))) {
    const mod = await server.ssrLoadModule(`/src/${module}`);
    const value = mod[fn](...args.map((a) => (a && typeof a === "object" && "$map" in a ? tempo.tempoMap(a.$map) : a && typeof a === "object" && "$time" in a ? timebase.timeContext(a.$time) : a)));
    out.push(value instanceof Uint8Array ? [...value] : value);
  }
  process.stdout.write(JSON.stringify(out));
} finally {
  await server.close();
}
