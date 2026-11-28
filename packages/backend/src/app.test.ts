import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { HiveDb } from "./db";
import { EventHub } from "./events";
import * as git from "./git";
import { Hive } from "./hive";
import { FakeProbe, FakeRunner } from "./testing";

interface Reply {
  status: number;
  body: any;
  headers: Record<string, unknown>;
}

describe("the API's local-only guard", () => {
  let server: Server;
  let port: number;
  let db: HiveDb;

  beforeEach(async () => {
    db = new HiveDb(":memory:");
    const hub = new EventHub();
    const hive = new Hive({
      db, hub, git, runner: new FakeRunner(), probe: new FakeProbe(),
      role: (name) => ({ name, model: "opus", kind: "conversation", instructions: "" }),
      specFormatDir: "/nonexistent",
    });
    server = await new Promise<Server>((resolve) => {
      const s = createApp(hive, hub, { ports: [0] }).listen(0, "127.0.0.1", () => resolve(s));
    });
    port = (server.address() as AddressInfo).port;
    // The guard needs the real port, which is only known once listening.
    server.close();
    server = await new Promise<Server>((resolve) => {
      const s = createApp(hive, hub, { ports: [port, 5173] }).listen(port, "127.0.0.1", () => resolve(s));
    });
  });
  afterEach(() => {
    server.close();
    db.close();
  });

  const send = (method: string, path: string, headers: Record<string, string>, body?: string) =>
    new Promise<Reply>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, method, path, headers }, (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode!, body: text ? JSON.parse(text) : null, headers: res.headers }));
      });
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });

  it("answers its own page", async () => {
    const r = await send("GET", "/api/health", { host: `127.0.0.1:${port}` });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "ok" });
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("serves For you", async () => {
    const r = await send("GET", "/api/for-you", { host: `127.0.0.1:${port}` });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ items: [] });
  });

  it("serves the roles, with the ones still to be written even when roles/ gives none", async () => {
    const r = await send("GET", "/api/roles", { host: `127.0.0.1:${port}` });
    expect(r.status).toBe(200);
    expect(r.body.roles.map((role: { name: string }) => role.name)).toEqual(["tester", "manager"]);
  });

  it("refuses a foreign Host, as DNS rebinding would send", async () => {
    const r = await send("GET", "/api/board", { host: `evil.example:${port}` });
    expect(r.status).toBe(403);
  });

  it("refuses a foreign Origin but accepts the dev page's", async () => {
    const json = { host: `127.0.0.1:${port}`, "content-type": "application/json" };
    const foreign = await send("POST", "/api/projects", { ...json, origin: "https://evil.example" }, '{"path":"/"}');
    expect(foreign.status).toBe(403);
    const dev = await send("POST", "/api/projects", { ...json, origin: "http://localhost:5173" }, '{"path":"nope"}');
    expect(dev.status).toBe(400); // past the guard, refused by the hive itself
  });

  // docs/specs/2026-11-28-folder-autocomplete-and-git-init-when-ad.md
  describe("folders for a project", () => {
    let dir: string;
    beforeEach(() => {
      dir = realpathSync(mkdtempSync(join(tmpdir(), "hive-api-folders-")));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("completes a typed path with folder names only, behind the guard", async () => {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "secret.txt"), "x");
      const path = `/api/folders?path=${encodeURIComponent(`${dir}/`)}`;
      const r = await send("GET", path, { host: `127.0.0.1:${port}` });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ folders: [{ name: "src", value: `${dir}/src/` }], more: 0 });
      expect((await send("GET", path, { host: `evil.example:${port}` })).status).toBe(403);
    });

    it("answers 200 { missing } for a project path that doesn't exist", async () => {
      const missing = join(dir, "new");
      const json = { host: `127.0.0.1:${port}`, "content-type": "application/json" };
      const r = await send("POST", "/api/projects", json, JSON.stringify({ path: missing }));
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ missing });
    });
  });

  it("refuses a body that isn't JSON", async () => {
    const r = await send("POST", "/api/cards", { host: `127.0.0.1:${port}`, "content-type": "text/plain" }, "hi");
    expect(r.status).toBe(415);
  });

  it("accepts a POST without a body", async () => {
    const r = await send("POST", "/api/cards/nope/stop", { host: `localhost:${port}` });
    expect(r.status).toBe(404);
  });
});

describe("a card's mockup, served (docs/specs/2026-11-28-mockup-lane-and-designer-role.md, Serving the pages)", () => {
  let server: Server;
  let port: number;
  let db: HiveDb;
  let base: string;
  let dir: string;
  const cardId = "card-1";

  beforeEach(async () => {
    // Every worktree sits under <repo>/.claude/worktrees/: a dot-folder that sendFile refuses unless it's the root.
    base = mkdtempSync(join(tmpdir(), "hive-mockup-"));
    const worktree = join(base, "repo", ".claude", "worktrees", "font-1");
    dir = join(worktree, "docs", "mockups", "font-1");
    mkdirSync(join(dir, "js"), { recursive: true });
    writeFileSync(join(dir, "index.html"), "<!doctype html><script type=module src=js/app.js></script><h1>v1</h1>");
    writeFileSync(join(dir, "js", "app.js"), "document.body.append('ran');");
    writeFileSync(join(dir, ".secret"), "hidden");
    writeFileSync(join(worktree, "app.txt"), "outside the folder");
    symlinkSync(join(worktree, "app.txt"), join(dir, "escape.html"));

    db = new HiveDb(":memory:");
    db.insertProject({ id: "p1", name: "repo", path: join(base, "repo"), trustWarning: false });
    db.insertCard({
      id: cardId, projectId: "p1", title: "Font", ideaTitle: "Font", ideaText: "x", lane: "mockup", state: "needs-you",
      branch: "hive/font-1", worktreePath: worktree, brief: null, moveError: null, specPath: null, reviewedSpecHash: null,
      reviewApplying: false, plan: null, build: null, check: null, setup: null, port: null, feedback: null,
      appStopped: false, landing: null, landed: null, shipAfterCheck: false,
    });
    db.updateCard(cardId, {
      mockup: { folder: "docs/mockups/font-1", current: { kind: "pages", page: "docs/mockups/font-1/index.html" }, kept: null },
    });
    const hub = new EventHub();
    const hive = new Hive({
      db, hub, git, runner: new FakeRunner(), probe: new FakeProbe(),
      role: (name) => ({ name, model: "opus", kind: "conversation", instructions: "" }),
      specFormatDir: "/nonexistent",
    });
    server = await new Promise<Server>((resolve) => {
      const s = createApp(hive, hub, { ports: [0] }).listen(0, "127.0.0.1", () => resolve(s));
    });
    port = (server.address() as AddressInfo).port;
    server.close();
    server = await new Promise<Server>((resolve) => {
      const s = createApp(hive, hub, { ports: [port] }).listen(port, "127.0.0.1", () => resolve(s));
    });
  });
  afterEach(() => {
    server.close();
    db.close();
    rmSync(base, { recursive: true, force: true });
  });

  /** A GET with the raw text back, since a mockup file isn't JSON. */
  const get = (path: string, headers: Record<string, string> = {}) =>
    new Promise<{ status: number; text: string; headers: Record<string, unknown> }>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, method: "GET", path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode!, text, headers: res.headers }));
      });
      req.on("error", reject);
      req.end();
    });
  const url = (file: string) => `/api/cards/${cardId}/mockup/${file}`;

  it("sends a page sandboxed, with CORS for its own files, and never cached", async () => {
    const r = await get(url("index.html"));
    expect(r.status).toBe(200);
    expect(r.text).toContain("<h1>v1</h1>");
    expect(r.headers["content-type"]).toMatch(/^text\/html/);
    expect(r.headers["content-security-policy"]).toBe("sandbox allow-scripts allow-forms allow-popups allow-modals");
    expect(r.headers["access-control-allow-origin"]).toBe("*");
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("shows the designer's latest edit on the next request", async () => {
    await get(url("index.html"));
    writeFileSync(join(dir, "index.html"), "<h1>v2</h1>");
    expect((await get(url("index.html"))).text).toBe("<h1>v2</h1>");
  });

  it("lets the sandboxed page's own requests through with Origin: null, and refuses other sites", async () => {
    const script = await get(url("js/app.js"), { origin: "null" });
    expect(script.status).toBe(200);
    expect(script.headers["content-type"]).toMatch(/javascript/);
    expect((await get(url("js/app.js"), { origin: "https://example.com" })).status).toBe(403);
    // Origin: null reaches nothing but the mockup's files.
    expect((await get("/api/board", { origin: "null" })).status).toBe(403);
    expect((await get(`/api/cards/${cardId}`, { origin: "null" })).status).toBe(403);
  });

  it("answers 404 for a dotfile, a way out of the folder, a missing file, a folder and an unknown card", async () => {
    for (const path of [
      url(".secret"), url("%2E%2E/%2E%2E/%2E%2E/app.txt"), url("js/%2E%2E/%2E%2E/%2E%2E/%2E%2E/app.txt"), url("escape.html"),
      url("missing.html"), url("js"), "/api/cards/nope/mockup/index.html",
    ]) {
      const r = await get(path);
      expect([path, r.status]).toEqual([path, 404]);
      expect(r.text).not.toContain("outside the folder");
      expect(r.text).not.toContain("hidden");
    }
  });
});
