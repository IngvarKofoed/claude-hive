// The Express app: the API under /api and, when it has been built, the page.
import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProjectChats } from "./chats";
import type { EventHub } from "./events";
import type { Hive } from "./hive";
import { apiRouter } from "./routes/api";
import { localOnly } from "./security";

export interface AppOptions {
  /** Ports the page may be served from: the hive's own, and Vite's in dev. */
  ports: number[];
  /** The built page (packages/frontend/dist), served when it exists. */
  pageDir?: string;
  /** The project chats, beside the hive (docs/specs/2026-11-28-chat-with-a-project-then-make-it-an-idea.md). */
  chats: ProjectChats;
}

export function createApp(hive: Hive, hub: EventHub, options: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use(localOnly(options.ports));
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", apiRouter(hive, hub, options.chats));

  if (options.pageDir && existsSync(join(options.pageDir, "index.html"))) {
    app.use(express.static(options.pageDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(options.pageDir!, "index.html")));
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ error: "Something went wrong in the hive. See its log." });
  });
  return app;
}
