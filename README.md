# @veksa/transport

[![npm version](https://img.shields.io/npm/v/@veksa/transport.svg?style=flat-square)](https://www.npmjs.com/package/@veksa/transport)
[![npm downloads](https://img.shields.io/npm/dm/@veksa/transport.svg?style=flat-square)](https://www.npmjs.com/package/@veksa/transport)
[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE.md)

A reactive transport layer for messaging communication with pluggable adapters and RxJS observables

## Installation

@veksa/transport requires **TypeScript 5.8 or later**.

### Using npm or yarn

```bash
# npm
npm install @veksa/transport

# yarn
yarn add @veksa/transport
```

## Features

- A connection supervisor: reconnect with exponential backoff and jitter, liveness probes that drop a frozen
  socket, fallback addresses, no redial after a deliberate disconnect, online/offline and foreground inputs
- Request timeouts
- Stream-based messaging with RxJS observables
- Pluggable transport adapters (socket, host, client)
- Cross-window and iframe messaging support
- Reactive state management for connection status
- JSON encoding/decoding with customizable codecs
- Automatic message ID handling
- TypeScript support with comprehensive interfaces
- Integration with @veksa/logger for debugging

## Basic Usage

### Supervised socket transport

`createSocketTransport` is a socket transport that keeps itself connected: `connect()` once, and it redials every
drop until `disconnect()`.

```typescript
import { createSocketTransport, createJsonCodec, DropReason } from '@veksa/transport';
import { createLogger } from '@veksa/logger';

const transport = createSocketTransport({
  type: 'server',
  url: ['wss://api.example.test/ws', 'wss://relay.example.test/ws'], // primary, then fallbacks; or one string
  protocol: 'myapp-v1',
  codec: createJsonCodec(),
  logger: createLogger(true),
  getMessageName: (message) => `Message-${message.payloadType}`,
  prefix: 'S',
  isError: (message) => message.payloadType === 50,
  liveness: { payloadType: 3 }, // echoed by the server; probe every 15 s, drop after 10 s without the echo
});

transport.connect();

transport.state$.subscribe((state) => console.log('state', state)); // Connecting, Connected, Disconnected

transport.events$.subscribe((event) => {
  if (event.type === 'connected') {
    // a new connection: sign in on it
  }
  if (event.type === 'dropped' && event.reason === DropReason.Stalled) {
    // the liveness echo did not come: the network froze the socket; it is being redialed
  }
});

// Platform inputs (the core imports no framework)
window.addEventListener('online', () => transport.setOnline(true));
window.addEventListener('offline', () => transport.setOnline(false));
document.addEventListener('visibilitychange', () => transport.setForeground(document.visibilityState === 'visible'));

// Requests time out after 20 s by default
const response = await transport.api.send({ payloadType: 1, payload: { userId: 123 }, clientMsgId: '' });

transport.reconnect();  // drop and dial a fresh connection now (a sign-out)
transport.disconnect(); // stop: nothing is redialed until connect()
```

Moving from hand-written reconnect, heartbeat and ping code: [docs/MIGRATION.md](docs/MIGRATION.md).

### Socket Transport

```typescript
import { createTransport, createJsonCodec, createSocketAdapter } from '@veksa/transport';

const adapter = createSocketAdapter({
  prefix: 'S',
  url: 'wss://api.example.test/socket',
  protocol: 'myapp-v1',
  codec: createJsonCodec(),
  getMessageName: (message) => `Message-${message.payloadType}`,
  logger,
});

// A plain transport: it connects when told and reports the state; nothing redials.
const transport = createTransport({ type: 'server', adapter, logger });

transport.connect();

transport.api.send({
  payloadType: 1,
  payload: { userId: 123 },
  clientMsgId: 'abc-123',
}).then((response) => {
  console.log('Received response:', response);
});

transport.api.event$.subscribe((message) => {
  console.log('Received event:', message);
});

transport.disconnect();
```

### Cross-Window Communication

#### Host Page (Parent Window)
```typescript
import { createTransport, createHostAdapter } from '@veksa/transport';
import { createLogger } from '@veksa/logger';

const logger = createLogger(true);
const iframe = document.getElementById('my-iframe') as HTMLIFrameElement;

// Create host adapter to communicate with the iframe
const transport = createTransport({
  adapter: createHostAdapter({
    frame: iframe,
    prefix: 'Host',
    prefixColor: '#4CAF50',
    getMessageName: (type) => `Message-${type}`,
    logger,
  }),
});

// Connect to the transport
transport.connect();

// Send a message to the iframe client
transport.api.send({
  payloadType: 1,
  payload: { action: 'initialize' },
  clientMsgId: 'init-123',
});
```

#### Client Page (Inside iframe)
```typescript
import { createTransport, createClientAdapter } from '@veksa/transport';
import { createLogger } from '@veksa/logger';

const logger = createLogger(true);

// Create client adapter to communicate with the host
const transport = createTransport({
  adapter: createClientAdapter({
    prefix: 'Client',
    prefixColor: '#2196F3',
    getMessageName: (type) => `Message-${type}`,
    logger,
  }),
});

// Connect to the transport
transport.connect();

// Listen for messages from the host
transport.api.event$.subscribe((message) => {
  console.log('Received from host:', message);
});
```

## Codecs

### createJsonCodec(getBinaryKeys?)

Creates a JSON codec for encoding/decoding messages. Supports optional binary field handling for Uint8Array data.

#### Without binaryKeys (default)

Serializes messages as plain JSON. Note that Uint8Array fields are serialized as objects, which is inefficient:

```typescript
const codec = createJsonCodec();

const message = {
  payloadType: 1,
  clientMsgId: 'abc',
  payload: { chunk: new Uint8Array([1, 2, 3]) }
};

// Encodes as: {"payloadType":1,"clientMsgId":"abc","payload":{"chunk":{"0":1,"1":2,"2":3}}}
// Inefficient for large binary data!
```

#### With binaryKeys

Optimizes encoding/decoding of Uint8Array fields by converting them to base64 strings:

```typescript
const codec = createJsonCodec(() => ['payload.chunk']);

const message = {
  payloadType: 1,
  clientMsgId: 'abc',
  payload: { chunk: new Uint8Array([1, 2, 3]) }
};

// Encodes as: {"payloadType":1,"clientMsgId":"abc","payload":{"chunk":"AQID"}}
// Much more efficient for binary data!
```

#### Nested Fields

Binary keys support dot notation for nested paths:

```typescript
const codec = createJsonCodec(() => ['payload.data.binary']);

const message = {
  clientMsgId: 'test',
  payload: {
    data: {
      binary: new Uint8Array([1, 2, 3])
    }
  }
};

// The nested binary field is correctly encoded/decoded
const encoded = codec.encode(message);
const decoded = codec.decode(encoded);

console.log(decoded.payload.data.binary); // Uint8Array [1, 2, 3]
```

#### Multiple Binary Fields

Specify multiple paths for handling multiple binary fields:

```typescript
const codec = createJsonCodec(() => [
  'payload.chunk',
  'payload.thumbnail'
]);

const message = {
  payloadType: 1,
  clientMsgId: 'abc',
  payload: {
    chunk: new Uint8Array([1, 2, 3]),
    thumbnail: new Uint8Array([4, 5, 6])
  }
};
```

#### Performance Considerations

- **Without binaryKeys**: Fast for plain JSON, but very slow for Uint8Array (serializes as object with thousands of properties)
- **With binaryKeys**: ~100x faster encode for binary data, slight overhead for decode but overall much more efficient
- **Size**: Binary fields encoded as base64 are ~33% larger than raw binary, but still 10-100x smaller than object serialization

## API Reference

### createTransport(options)

Creates a new transport instance.

- `type`: A string identifier for the transport type
- `adapter`: An implementation of `ITransportAdapter` (a supervised one included)
- `logger`: An instance of `ILogger` from @veksa/logger
- `isError`: Optional function to determine if a message represents an error
- `requestTimeout`: ms a request waits for its reply before it fails with `RequestTimeout`; default 20000, `0` waits
  for ever

The positional form `createTransport(type, adapter, logger, isError)` still works, without a request timeout; it is
deprecated.

#### Transport Methods

- `connect()`: Establishes a connection
- `disconnect()`: Terminates the connection
- `state$`: Observable of transport connection state; a new subscriber gets the current state at once
- `api.send(message, options?)`: Sends a message and returns a Promise with the response payload. It rejects with
  `{errorCode: 'ClosedConnection', description}` when the transport is not `Connected` at the time of the call (nothing
  is sent) or when the connection drops while the request is in flight, and with `{errorCode: 'RequestTimeout'}` when
  no reply comes within the timeout (`options.timeout` overrides it for one request). `isClosedConnection`,
  `isRequestTimeout` and `isTransportError` tell these apart from a reply
- `api.event$`: Observable of incoming events
- `getLogs()`: Retrieves logs if using @veksa/logger

### createSocketTransport(options)

A socket adapter under a connection supervisor behind a transport. Options: those of `createSocketAdapter` and
`createTransport`, plus

- `url`: one address or `[primary, ...fallbacks]`
- `liveness`: `{payloadType, interval = 15000, timeout = 10000}`; without it the connection is not probed
- `reconnect`: `{minDelay = 1000, maxDelay = 30000, factor = 2, jitter = 0.5, stableAfter = 10000, maxAttempts = Infinity}`
- `routing`: `{failuresToLeave = 2, failureWindow = 600000, retryPrimaryAfter = 86400000, failuresToReturn = 3, storage?, storageKey = 'transport.route'}`
- `handshakeTimeout` (5000), `requestTimeout` (20000)

Besides the `ITransport` members it has

- `events$`: `dialing`, `connected`, `dialFailed`, `dropped` (with a `DropReason`: `Closed`, `Stalled`, `Held`,
  `Restart`, `Deliberate`), `retryScheduled`, `gaveUp`, `alive` (the liveness reply and its round trip), `route`
- `status$` / `getStatus()`: the phase (`Stopped`, `Dialing`, `Open`, `Waiting`, `Offline`, `GaveUp`), address,
  failed attempts in a row, connection generation, next attempt time
- `reconnect()`: drop and dial a fresh connection now
- `wake()`: dial now if waiting, probe if open
- `probe()`: send a liveness probe now
- `setOnline(online)`, `setForeground(foreground)`: platform inputs
- `dispose()`: stop for good

`disconnect()` is deliberate: the supervisor never redials after it. Every other drop is redialed. The full rule set
is in [docs/MIGRATION.md](docs/MIGRATION.md#rules-and-defaults).

### createConnectionSupervisor(options)

The supervisor on its own, over any `ITransportAdapter`: `{adapter, addresses?, useAddress?, liveness?: {frame,
interval, timeout}, reconnect?, routing?}`. It returns an adapter (hand it to `createTransport`) with the controls
above.

### Adapter Types

#### createSocketAdapter(options)

Creates a WebSocket-based transport adapter.

- `prefix`: Logger prefix for identifying messages
- `prefixColor`: Optional color for log messages
- `url`: WebSocket endpoint URL, or a function read at every connect
- `protocol`: WebSocket protocol
- `handshakeTimeout`: ms the socket may take to open, default 5000
- `codec`: Message encoding/decoding implementation
- `getMessageName`: Function that names a message for the log
- `logger`: Instance of @veksa/logger

#### createHostAdapter(options)

Creates an adapter for the host/parent window to communicate with an iframe.

- `frame`: Reference to the iframe element
- `prefix`: Logger prefix for identifying messages
- `prefixColor`: Color for log messages (optional)
- `getPayloadName`: Function to convert payload type to a readable name
- `logger`: Instance of @veksa/logger

#### createClientAdapter(options)

Creates an adapter for iframe content to communicate with the host window.

- `prefix`: Logger prefix for identifying messages
- `prefixColor`: Color for log messages (optional)
- `getPayloadName`: Function to convert payload type to a readable name
- `logger`: Instance of @veksa/logger

### Interface Reference

- `ITransport<Type, InputMessage, OutputMessage, EventMessage>`: Main transport interface
- `ITransportAdapter<InputMessage, OutputMessage, EventMessage>`: Adapter interface for various connection types
- `ITransportApi<Type, InputMessage, OutputMessage, EventMessage>`: API interface for sending messages and subscribing to events
- `ITransportCodec<Message>`: Interface for message encoding/decoding
- `IMessage<Payload>`: Standard message format with payload and client message ID
- `ISocketMessage`: Interface for socket messages
- `IPostMessage`: Interface for post messages (cross-window communication)

## Contributing

This project welcomes contributions and suggestions.

## License

[MIT](LICENSE.md)
