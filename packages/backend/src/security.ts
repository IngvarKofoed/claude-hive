// Only the hive's own page may call the API (spec: Workspace). Binding to 127.0.0.1 doesn't stop a web page
// you visit from reaching the hive through DNS rebinding, and this API starts full-access sessions on paths and
// prompts the caller picks. So: the Host must be the hive itself, a foreign Origin is refused, no CORS headers
// are ever sent, and a request body must be JSON.
import type { NextFunction, Request, Response } from "express";

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
    if (origin !== undefined && !origins.has(origin)) {
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
