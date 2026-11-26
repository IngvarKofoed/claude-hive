// The live event stream (GET /api/events): one SSE connection per open page.
import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import type { HiveEvent } from "@hive/shared";

export class EventHub {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  emit(event: HiveEvent): void {
    this.emitter.emit("event", event);
  }

  subscribe(listener: (event: HiveEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  /** Express handler that streams every event to the page until it disconnects. */
  handler = (req: Request, res: Response): void => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");
    const unsubscribe = this.subscribe((event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  };
}
