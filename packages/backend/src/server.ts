// Starts the hive on 127.0.0.1 only: the page can start sessions that run commands on your machine, so it must
// never be reachable from the network (docs/ARCHITECTURE.md, Tech Stack).
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_VERSION } from "@hive/shared";
import { createApp } from "./app";
import { HiveDb } from "./db";
import { EventHub } from "./events";
import * as git from "./git";
import { Hive } from "./hive";
import { loadRole } from "./sessions/roles";
import { SdkRunner } from "./sessions/sdkRunner";
import { SdkTrustProbe } from "./sessions/trustProbe";

const port = Number(process.env.HIVE_PORT ?? 4317);
const devPagePort = Number(process.env.HIVE_DEV_PAGE_PORT ?? 5173);
const dbPath = process.env.HIVE_DB ?? join(homedir(), ".claude-hive", "hive.db");
const pageDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../frontend/dist");

const db = new HiveDb(dbPath);
const hub = new EventHub();
const hive = new Hive({
  db, hub, git, runner: new SdkRunner(), probe: new SdkTrustProbe(), role: (name) => loadRole(name),
});
hive.recoverAfterRestart();

createApp(hive, hub, { ports: [port, devPagePort], pageDir }).listen(port, "127.0.0.1", () => {
  console.log(`Claude Hive ${APP_VERSION} on http://127.0.0.1:${port} (data: ${dbPath})`);
});
