import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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

  it("refuses a foreign Host, as DNS rebinding would send", async () => {
    const r = await send("GET", "/api/board", { host: `evil.example:${port}` });
    expect(r.status).toBe(403);
  });

  it("refuses a foreign Origin but accepts the dev page's", async () => {
    const json = { host: `127.0.0.1:${port}`, "content-type": "application/json" };
    const foreign = await send("POST", "/api/projects", { ...json, origin: "https://evil.example" }, '{"path":"/"}');
    expect(foreign.status).toBe(403);
    const dev = await send("POST", "/api/projects", { ...json, origin: "http://localhost:5173" }, '{"path":"/nope"}');
    expect(dev.status).toBe(400); // past the guard, refused by the hive itself
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
