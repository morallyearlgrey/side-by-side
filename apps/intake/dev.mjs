import { createServer } from "node:http";
import { createServer as createVite } from "vite";
import { makeSubmit, json } from "./server/submit.mjs";

const port = Number(process.env.PORT || 8090);
const server = createServer();
const vite = await createVite({
  server: { middlewareMode: true, hmr: { server } },
  appType: "spa",
});
const submit = makeSubmit({
  env: {},
  preview: true,
  previewOrigin: `http://localhost:${port}`,
});
server.on("request", (req, res) => {
  if (req.url === "/api/config") return json(res, 200, { mode: "preview" });
  if (req.url === "/api/submit") {
    // Both loopback hostnames are valid for this non-persisting preview.
    if (req.headers.origin === `http://127.0.0.1:${port}`)
      req.headers.origin = `http://localhost:${port}`;
    return void submit(req, res).catch(() =>
      json(res, 500, { error: "Preview unavailable." }),
    );
  }
  vite.middlewares(req, res);
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `SidebySide intake: http://localhost:${port} (preview only; no answers saved)`,
  ),
);
async function close() {
  await vite.close();
  server.close(() => process.exit(0));
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
