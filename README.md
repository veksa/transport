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

- Stream-based messaging with RxJS observables
- Pluggable transport adapters (socket, host, client)
- Cross-window and iframe messaging support
- Reactive state management for connection status
- JSON encoding/decoding with customizable codecs
- Automatic message ID handling
- TypeScript support with comprehensive interfaces
- Integration with @veksa/logger for debugging

## Basic Usage

### Socket Transport

```typescript
import { createTransport, createJsonCodec, createSocketAdapter } from '@veksa/transport';

// Create transport with socket adapter
const transport = createTransport({
  adapter: createSocketAdapter({
    url: 'wss://example.com/socket',
    codec: createJsonCodec(),
  }),
});

// Connect to the transport
transport.connect();

// Subscribe to state changes
transport.state$.subscribe((state) => {
  console.log('Transport state:', state);
});

// Send a message and get response
transport.api.send({
  payloadType: 1,
  payload: { userId: 123 },
  clientMsgId: 'abc-123',
}).then((response) => {
  console.log('Received response:', response);
});

// Subscribe to incoming events
transport.api.event$.subscribe((message) => {
  console.log('Received event:', message);
});

// Disconnect when done
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
    getPayloadName: (type) => `Message-${type}`,
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
    getPayloadName: (type) => `Message-${type}`,
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

## API Reference

### createTransport(options)

Creates a new transport instance.

#### Options

- `adapter`: An implementation of `ITransportAdapter`

#### Transport Methods

- `connect()`: Establishes a connection
- `disconnect()`: Terminates the connection
- `state$`: Observable of transport connection state
- `api.send(message)`: Sends a message and returns a Promise with the response payload
- `api.event$`: Observable of incoming events
- `getLogs()`: Retrieves logs if using @veksa/logger

### Adapter Types

#### createSocketAdapter(options)

Creates a WebSocket-based transport adapter.

- `url`: WebSocket endpoint URL
- `codec`: Message encoding/decoding implementation

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

- `ITransport<Type>`: Main transport interface
- `ITransportAdapter`: Adapter interface for various connection types
- `ITransportCodec`: Interface for message encoding/decoding
- `IMessage<Payload>`: Standard message format with payload, type, and ID

## Contributing

This project welcomes contributions and suggestions.

## License

[MIT](LICENSE.md)
