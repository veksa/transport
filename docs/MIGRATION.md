# Migrating to the connection supervisor

Until now `@veksa/transport` opened a socket and reported its state; everything that keeps a connection alive was
left to the app: redialing after a drop, a heartbeat timer, a liveness ping that drops a frozen socket, a primary
and a fallback address, guarding against a second socket, giving up a request that never gets an answer. Every app
wrote its own, and the copies drifted apart. These now live in the transport, written once:

| The app used to own | Now |
|---|---|
| A reconnect epic / effect: on `Disconnected`, `connect()` again after a fixed pause | The supervisor redials every drop that was not deliberate, with exponential backoff and jitter |
| A "locked" / "signed out" filter so a deliberate `disconnect()` is not redialed | `disconnect()` stops the supervisor; nothing redials until `connect()` |
| A heartbeat timer per connection (and the bug where every reconnect stacked one more timer) | One liveness timer per open connection, started on open, stopped on the drop |
| A ping epic: ping every 15 s, drop the socket when no answer in 10 s | `liveness: {payloadType, interval, timeout}`; a missing echo drops and redials |
| A wrapper that refuses to open a second socket | `connect()` is idempotent; one connection and one dial at a time |
| A wrapper that switches between a primary and a fallback address | `url: [primary, ...fallbacks]` plus `routing` |
| `timeout(...)` around each request that must not hang | `requestTimeout` (default 20 s) on every request, `RequestTimeout` error code |
| Calling `connect()` when the app returns to the foreground | `setForeground(true)` / `setOnline(true)` / `wake()` |

What stays in the app is what is specific to it: signing in on every new connection, the UI state built from the
connection (a "reachable" flag, a "connection is limited" banner, the server clock read from the liveness reply),
which events mean "the network may be back", and retrying its own idempotent requests on the next session.

## 1. Build the transport

Before:

```ts
const adapter = createSocketAdapter({prefix: 'S', url: SERVER_URL, protocol: 'myapp-v1', codec, getMessageName, logger});
const server = createTransport('server', adapter, logger, isServerError);
```

After:

```ts
import {createJsonCodec, createSocketTransport} from '@veksa/transport';

const server = createSocketTransport({
    type: 'server',
    url: ['wss://api.example.test/ws', 'wss://relay.example.test/ws'], // or a single string
    protocol: 'myapp-v1',
    codec: createJsonCodec(),
    getMessageName,
    logger,
    prefix: 'S',
    isError: isServerError,
    liveness: {payloadType: PayloadType.PingReq},  // the frame the server echoes; 15 s / 10 s by default
    routing: {storage: routeStorage},              // optional: keep a fallback choice across launches
});

server.connect();
```

`server` is an `ITransport` (`state$`, `api`, `connect`, `disconnect`, `getLogs`), so code that receives the
transport as a dependency keeps working. It also carries the supervisor's controls: `events$`, `status$`,
`getStatus()`, `reconnect()`, `wake()`, `probe()`, `setOnline()`, `setForeground()`, `dispose()`.

To supervise another adapter (or a socket adapter you build yourself), wrap it:

```ts
const supervised = createConnectionSupervisor({adapter, liveness: {frame: () => ({payloadType: 7, payload: {}})}});
const transport = createTransport({type: 'server', adapter: supervised, logger, isError});
```

## 2. Delete the connection plumbing

- **The reconnect epic / effect** (`on Disconnected → timer → connect()`): delete. Call `connect()` once at start.
- **The heartbeat epic / interval**: delete. Configure `liveness` with the heartbeat's payloadType instead.
- **The ping epic**: delete. Configure `liveness` with the ping's payloadType. Read what the ping returned from the
  `alive` event (below).
- **A single-socket wrapper**: delete. `connect()` while connected or connecting is a no-op; for a store that is
  thrown away call `dispose()`, after which `connect()` never dials again.
- **An address-routing wrapper**: delete. Pass the addresses as `url: [...]` and tune `routing`.
- **Lock filters** in the reconnect path: delete. A lock (biometry, a host window that takes the session away) calls
  `disconnect()` and the unlock calls `connect()`; nothing redials in between.
- **Request-level timeouts** that turn a silent socket into an error: delete; `requestTimeout` does it. If the app
  treated such a timeout as a dropped connection, check `isTransportError(error)` (either `ClosedConnection` or
  `RequestTimeout`) where it checked for `ClosedConnection`.
- **A manual "disconnect and connect" for sign-out**: call `reconnect()`. It drops the connection (requests in
  flight fail with `ClosedConnection`) and dials a fresh one at once.

## 3. Map the events to the app's state

```ts
server.events$.subscribe(event => {
    switch (event.type) {
        case 'connected':      // a new connection: sign in on it (the app's own request)
        case 'alive':          // the liveness echo: event.message is the reply, event.rtt its round trip
        case 'dropped':        // event.reason: Closed | Stalled | Held | Restart | Deliberate
        case 'route':          // the supervisor moved to event.address (index 0 is the primary)
        case 'retryScheduled': // event.delay until the next attempt
        case 'gaveUp':         // maxAttempts failed dials in a row (off by default)
    }
});
```

- *Reachable* ("the server answered", not just "the socket is open"): true on `alive`, false on any state but
  `Connected`.
- *Limited connection* banner: `dropped` with `reason === DropReason.Stalled`. `Held` means the whole app was
  suspended (the probe timer fired far later than it was set for), which is not the network's fault.
- *Server clock*: if the liveness reply carries one, read it from `event.message.payload`.
- *Sign in on every connection*: on `connected` (or `state$` reaching `Connected`), as before.

`state$` keeps its meaning and replays the current state. It now passes through `Connecting` while a socket opens
(the plain socket adapter reports it too). Code that acted on `Disconnected` to redial is gone; code that reads
`Connected` is unchanged.

## 4. Feed in the platform

The core imports no framework. The app reports what its platform knows:

```ts
// Browser
window.addEventListener('online', () => server.setOnline(true));
window.addEventListener('offline', () => server.setOnline(false));
document.addEventListener('visibilitychange', () => server.setForeground(document.visibilityState === 'visible'));

// A mobile runtime: from its app-state and network-state modules, e.g.
appState.onChange(state => server.setForeground(state === 'active'));
network.onChange(info => server.setOnline(info.isConnected !== false));

// Anything else that says "the network may be back" (a push that opened the app, an incoming call):
server.wake();
```

Offline pauses dialing and probes an open connection rather than dropping it (an offline report is a hint). Online,
a return to the foreground and `wake()` dial at once when waiting, or probe at once when open. A "check connection"
button calls `probe()`.

## Rules and defaults

| Rule | Default |
|---|---|
| The first dial on `connect()`, `wake()`, a return online or to the foreground | at once, no timer |
| Attempt n of a row of failures waits `min(maxDelay, minDelay·factor^(n−1))`, minus up to `jitter` of it at random | 1000 ms, ×2, cap 30 000 ms, jitter 0.5 |
| A connection open for `stableAfter` resets the row | 10 000 ms |
| Failed dials in a row before giving up (`maxAttempts`) | unlimited |
| Liveness probe: on open, then every `interval`; dropped when the echo takes longer than `timeout` | 15 000 ms / 10 000 ms |
| Any reply to the probe counts, an error frame included | — |
| Request timeout (`createTransport({...})`, `createSocketTransport`); per request `api.send(message, {timeout})` | 20 000 ms, `0` waits for ever |
| Handshake timeout | 5 000 ms |
| Routing: failures of the primary within `failureWindow` that move to the next address | 2 within 600 000 ms |
| Routing: how long a fallback is kept before the primary is tried again | 86 400 000 ms |
| Routing: failures in a row on a fallback that move on (past the last, back to the primary) | 3 |
| What counts as a failure of an address | a dial that never opened; a `Stalled` drop. Not `Closed`, `Held`, `Restart` |
| The saved route | key `transport.route`, value `{"address": string, "until": epoch ms}`, removed on the primary |

## Compatibility

- `createTransport(type, adapter, logger, isError)` still works and has no request timeout; it is deprecated in
  favour of `createTransport({type, adapter, logger, isError, requestTimeout})`, which times requests out after 20 s
  unless told otherwise.
- `createSocketAdapter` takes `url` as a string or a function read at every connect, and an optional
  `handshakeTimeout`. It reports `Connecting` while the socket opens.
- `ITransportApi.send` takes an optional second argument `{timeout}`.
- `ISocketMessage`, `ITransportCodec` and `createJsonCodec` are unchanged.
- An app that kept its own fallback choice under another key can hand the supervisor a `storage` whose `read`
  translates the old value into `{"address", "until"}` once, so devices do not lose it on the update.
