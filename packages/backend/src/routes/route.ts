// What every router here shares: a handler wrapper that turns HttpErrors into `{ error }`, and request readers.
import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../hive";

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;

/** Runs a handler and turns HttpErrors into `{ error }` with their status. */
export const route = (handler: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await handler(req, res);
    if (!res.headersSent) res.json(result ?? { ok: true });
  } catch (error) {
    if (error instanceof HttpError) res.status(error.status).json({ error: error.message });
    else next(error);
  }
};

export const param = (req: Request, name: string) => String(req.params[name]);

export const body = (req: Request) => (req.body ?? {}) as Record<string, any>;
