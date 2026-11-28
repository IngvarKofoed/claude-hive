// Starts the hive on 127.0.0.1 only: the page can start sessions that run commands on your machine, so it must
// never be reachable from the network (docs/ARCHITECTURE.md, Tech Stack).
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_VERSION } from "@hive/shared";
import { createApp } from "./app";
import { ProjectChats } from "./chats";
import { HiveDb } from "./db";
import { EventHub } from "./events";
import * as git from "./git";
import { Hive } from "./hive";
import { processApps } from "./preview/apps";
import { lsofPorts } from "./preview/ports";
import { listRoles, loadRole } from "./sessions/roles";
import { SdkRunner } from "./sessions/sdkRunner";
import { SdkTrustProbe } from "./sessions/trustProbe";

const port = Number(process.env.HIVE_PORT ?? 4317);
const devPagePort = Number(process.env.HIVE_DEV_PAGE_PORT ?? 5173);
const dbPath = process.env.HIVE_DB ?? join(homedir(), ".claude-hive", "hive.db");
const pageDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../frontend/dist");

const db = new HiveDb(dbPath);
const hub = new EventHub();
const specFormatDir = process.env.HIVE_SPEC_FORMAT_DIR ?? join(homedir(), ".claude", "skills", "spec-format");
const apps = processApps();
// The card apps the hive started end with it; startup starts them again (docs/specs/2026-11-27-try-it-runs-the-app.md).
// A signal listener replaces Node's default exit, so the handler exits by itself.
process.on("exit", () => apps.killAll());
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));
const runner = new SdkRunner();
const role = (name: string) => loadRole(name);
// Project chats run beside the hive, on the same database, event stream and session runner.
const chats = new ProjectChats({ db, hub, runner, role });
const hive = new Hive({
  db, hub, git, runner, probe: new SdkTrustProbe(), role,
  listRoles: () => listRoles(), specFormatDir,
  ports: lsofPorts,
  apps,
  chats,
});
hive.recoverAfterRestart();
chats.recoverAfterRestart();

createApp(hive, hub, { ports: [port, devPagePort], pageDir, chats }).listen(port, "127.0.0.1", () => {
  console.log(`Claude Hive ${APP_VERSION} on http://127.0.0.1:${port} (data: ${dbPath})`);
});
