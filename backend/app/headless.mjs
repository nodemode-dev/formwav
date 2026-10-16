import { join } from "node:path";
import { pathToFileURL } from "node:url";

// PLAN_v13 S12: the interface's own engine (frontend/src/engine, no page) for the headless command line: stdin is
// {op, doc, commands}; "catalogue" lists every command's parameters, "apply" applies the commands one by one and
// answers the document with each step's History words (null for a command the session refused), "inspect" summarises.
const frontend = process.argv[2];
const { createServer } = await import(pathToFileURL(join(frontend, "node_modules", "vite", "dist", "node", "index.js")).href);
const server = await createServer({ root: frontend, configFile: false, logLevel: "error", appType: "custom", server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { applyCommand } = await server.ssrLoadModule("/src/engine/document.ts");
  const { describeCommand } = await server.ssrLoadModule("/src/engine/describe.ts");
  const { commandCatalogue, isCommandType } = await server.ssrLoadModule("/src/engine/catalogue.ts");
  const { inspectSession } = await server.ssrLoadModule("/src/engine/inspect.ts");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const { op, doc, commands = [] } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  let out;
  if (op === "catalogue") out = commandCatalogue(doc);
  else if (op === "inspect") out = inspectSession(doc);
  else {
    let n = 0;
    const newId = () => `cli${Date.now().toString(36)}${++n}`;
    let now = doc;
    const steps = [];
    for (const cmd of commands) {
      if (!isCommandType(cmd?.type)) throw new Error(`there is no engine command ${JSON.stringify(cmd?.type)}`);
      const next = applyCommand(now, cmd, newId);
      steps.push(next === now || JSON.stringify(next) === JSON.stringify(now) ? null : describeCommand(cmd, now));
      now = next;
    }
    out = { doc: now, steps };
  }
  process.stdout.write(JSON.stringify(out));
} finally {
  await server.close();
}
