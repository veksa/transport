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
- Pluggable transport adapters (socket, host)
- Reactive state management for connection status
- JSON encoding/decoding with customizable codecs
- Automatic message ID handling
- TypeScript support with comprehensive interfaces
- Integration with @veksa/logger for debugging

## Basic Usage

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

## API Reference

### createTransport(options)

Creates a new transport instance.

### Options

- `adapter`: An implementation of `ITransportAdapter`

### Transport Methods

- `connect()`: Establishes a connection
- `disconnect()`: Terminates the connection
- `state$`: Observable of transport connection state
- `api.send(message)`: Sends a message and returns a Promise with the response payload
- `api.event$`: Observable of incoming events
- `getLogs()`: Retrieves logs if using @veksa/logger

### Interfaces

- `ITransport<Type>`: Main transport interface
- `ITransportAdapter`: Adapter interface for various connection types
- `ITransportCodec`: Interface for message encoding/decoding
- `IMessage<Payload>`: Standard message format

## Contributing

This project welcomes contributions and suggestions.

## License

[MIT](LICENSE.md)
