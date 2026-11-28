// Only the hive's own page may call the API (spec: Workspace). Binding to 127.0.0.1 doesn't stop a web page
// you visit from reaching the hive through DNS rebinding, and this API starts full-access sessions on paths and
// prompts the caller picks. So: the Host must be the hive itself, a foreign Origin is refused, and a request body must
// be JSON. The one exception is a card's mockup folder: its sandboxed pages run in an opaque origin, so their module
// scripts, fonts and fetch() send `Origin: null`, and only GET or HEAD of those files is let through with it. That
// route alone also sends a CORS header (docs/specs/2026-11-28-mockup-lane-and-designer-role.md).
import type { NextFunction, Request, Response } from "express";

/** A read of a card's mockup file, the only request an opaque origin (`Origin: null`) may make. */
const MOCKUP_FILE = /^\/api\/cards\/[^/]+\/mockup\/./;
const isMockupRead = (req: Request) => (req.method === "GET" || req.method === "HEAD") && MOCKUP_FILE.test(req.path);

export function localOnly(ports: number[]) {
  const hosts = new Set(ports.flatMap((p) => [`127.0.0.1:${p}`, `localhost:${p}`]));
  const origins = new Set(ports.flatMap((p) => [`http://127.0.0.1:${p}`, `http://localhost:${p}`]));

  return (req: Request, res: Response, next: NextFunction): void => {
    const host = req.headers.host;
    if (!host || !hosts.has(host)) {
      res.status(403).json({ error: "This hive only answers its own page." });
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(origin) && !(origin === "null" && isMockupRead(req))) {
      res.status(403).json({ error: "Requests from other sites are refused." });
      return;
    }
    const hasBody =
      req.headers["transfer-encoding"] !== undefined || Number(req.headers["content-length"] ?? 0) > 0;
    if (hasBody && !req.is("application/json")) {
      res.status(415).json({ error: "Request bodies must be JSON." });
      return;
    }
    next();
  };
}
