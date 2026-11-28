# App links to a loopback address use localhost

A setup's URL with `127.0.0.1` or `[::1]` is now linked as `localhost`, in Try it and in the developer's and reviewer's
messages. Vite's default host listens on `[::1]` alone on this Mac, and setups write `127.0.0.1`, so the card showed
the app as running with a link that was refused. `localhost` reaches a server on either, in browsers, curl and Node.

## Detail
- **Found on "Compact By lane for a 13" screen":** Vite listened on `[::1]:5231` and the link said `127.0.0.1:5231`.
  "Running" comes from `lsof` on the port, which sees IPv6, so the page said running. Two setups in a row reported
  "returned 200" for a URL they hadn't opened as written.
- **Rewritten in two places:** when a finished setup is stored, and when the hive builds the app entries and the
  sessions' running text, which covers setups stored before this change without preparing them again.
- **The setup role now checks each start command at its URL exactly as it reports it,** for mismatches the rewrite
  doesn't cover, such as a wrong path or a non-loopback host.
- **Rejected:** telling the setup to pin `host: "127.0.0.1"`, which depends on the model and leaves older setups
  broken; and marking a process running only when its URL answers, which would stop a working app over a wrong link.
- **Known gap:** with no app process, the Try it panel lists the stored setup's URLs as they are, so a setup stored
  before this change still shows `127.0.0.1` there until its app is started.
- **Not rewritten:** `0.0.0.0` and `[::]`, which no setup has reported so far.
