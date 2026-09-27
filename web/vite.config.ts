import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "development-deployment",
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const path = request.url?.split("?")[0];
          if (
            !path ||
            !/^\/(imd-deployment\.json|abi\/[A-Za-z0-9_]+\.json)$/.test(path)
          )
            return next();
          try {
            response.setHeader("Content-Type", "application/json");
            response.end(
              await readFile(
                resolve(import.meta.dirname, "../dist", "." + path),
              ),
            );
          } catch {
            response.statusCode = 503;
            response.end(
              JSON.stringify({
                error: "Run npm run build to generate the deployment manifest.",
              }),
            );
          }
        });
      },
    },
  ],
  build: { outDir: "../dist", emptyOutDir: true, sourcemap: false },
});
