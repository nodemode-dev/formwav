import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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
  const { KINDS } = await server.ssrLoadModule("/src/ui/editor-tabs.ts");
  const { cleanFx } = await server.ssrLoadModule("/src/engine/document.ts");
  const { flatStages } = await server.ssrLoadModule("/src/audio/player.ts");
  const { instance } = await WebAssembly.instantiate(readFileSync(join(frontend, "public", "core", "formwav_dsp.wasm")), {});
  const core = instance.exports;
  const player = core.fw_player_new();
  core.fw_set_rate(player, 48000);
  const designs = (f) => {
    core.fw_clear_master_fx(player);
    const s = flatStages([f]);
    return s.length === 6 && core.fw_add_master_stage(player, ...s) === 1;
  };
  const numeric = (f) => Object.keys(f).filter((k) => typeof f[k] === "number");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const candidates = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const kept = candidates.filter((kind) => cleanFx([{ kind }]).length === 1);
  const kinds = {};
  for (const kind of kept) {
    const fallback = cleanFx([{ kind }])[0];
    const keys = numeric(fallback);
    const low = cleanFx([{ kind, ...Object.fromEntries(keys.map((k) => [k, -1e12])) }])[0];
    const high = cleanFx([{ kind, ...Object.fromEntries(keys.map((k) => [k, 1e12])) }])[0];
    const card = KINDS[kind];
    const corners = (card?.params ?? []).flatMap(([key, , min, max]) =>
      [min, max].map((value) => {
        const placed = { ...fallback, ...card.init, [key]: value };
        const cleaned = cleanFx([placed])[0];
        return { key, value, kept: cleaned[key] === value, designs: designs(cleaned) };
      }),
    );
    kinds[kind] = {
      stage: flatStages([fallback]),
      fallback,
      low,
      high,
      designs: { fallback: designs(fallback), low: designs(low), high: designs(high) },
      catalogue: card ? { params: card.params, init: card.init } : null,
      corners,
    };
  }
  process.stdout.write(JSON.stringify({ catalogue: Object.keys(KINDS), kinds }));
} finally {
  await server.close();
}
