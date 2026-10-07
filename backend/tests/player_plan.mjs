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

const chunk = (xs, n) => Array.from({ length: Math.floor((xs?.length ?? 0) / n) }, (_, i) => xs.slice(i * n, i * n + n));
const pairs = (xs) => (xs ? chunk(xs, 2) : null);
// a processor stage names its spec by its place in the plan's list; the export's plan carries the spec itself
const named = (stages, specs) => stages.map((s) => (s[0] === 20 ? [20, specs[s[1]], 0, 0, 0, 0] : s));

try {
  const player = await server.ssrLoadModule("/src/audio/player.ts");
  const { cleanFx, FADE_SHAPES } = await server.ssrLoadModule("/src/engine/document.ts");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const out = JSON.parse(Buffer.concat(chunks).toString("utf8")).map((given) => {
    const doc = structuredClone(given);
    for (const track of doc.tracks) {
      if (track.fx) track.fx = cleanFx(track.fx);
      for (const clip of track.clips) if (clip.fx) clip.fx = cleanFx(clip.fx);
    }
    for (const bus of doc.buses ?? []) if (bus.fx) bus.fx = cleanFx(bus.fx);
    if (doc.masterFx) doc.masterFx = cleanFx(doc.masterFx);
    const ids = Object.keys(doc.media);
    const plan = player.planClips(doc, new Map(ids.map((id, i) => [id, i + 1])));
    const masterProcessors = [];
    return {
      doc,
      fadeShapes: FADE_SHAPES,
      plan: {
        end: plan.end,
        skipped: plan.skipped,
        clips: plan.clips.map((c) => ({
          media: ids[c.source - 1],
          start: c.start,
          sourceIn: c.sourceIn,
          length: c.length,
          gain: c.gain,
          pan: c.pan,
          fadeIn: c.fadeIn,
          fadeOut: c.fadeOut,
          fadeShape: c.fadeShape,
          bus: c.bus,
          gainPoints: pairs(c.gainPoints),
          panPoints: pairs(c.panPoints),
          fx: chunk(c.fx ?? [], 4),
          fxAuto: (c.fxAuto ?? []).map((a) => [a.stage, a.param, pairs(a.points)]),
          comp: c.comp ?? null,
        })),
        buses: plan.buses.map((b) => ({ gain: b.gain, pan: b.pan, stages: named(chunk(b.stages ?? [], 6), plan.processors), fxAuto: (b.fxAuto ?? []).map((a) => [a.stage, a.param, pairs(a.points)]) })),
        master: named(chunk(player.flatStages(doc.masterFx, masterProcessors), 6), masterProcessors),
        panLaw: plan.panLaw,
      },
    };
  });
  process.stdout.write(JSON.stringify(out));
} finally {
  await server.close();
}
