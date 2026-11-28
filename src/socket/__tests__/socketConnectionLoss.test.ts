import {Observable, Subject, Subscriber} from 'rxjs';
import {createSocketAdapter} from '../createSocketAdapter';
import {ISocketMessage} from '../socket.interface';
import {GetSocketResponses} from '../createSocketConnector';
import {createTransport} from '../../createTransport';
import {ITransportCodec, TransportState} from '../../interfaces';

interface IFakeSocket {
    observer: Subscriber<GetSocketResponses<string>>;
    server: Subject<string>;
    sent: string[];
}

// The latest fake socket opened by the adapter; the test drives it by hand.
let socket: IFakeSocket | undefined;

// How many connections the adapter has opened (subscriptions to the connector), not how often it built one.
let opened = 0;

// 'open' — the fake socket opens at once; 'pending' — it stays opening until the test settles it.
let connectorMode: 'open' | 'pending' = 'open';

// Requests in this suite carry their own clientMsgId.
jest.mock('../../_helpers/createMessageId', () => ({createMessageId: () => 'generated-id'}));

jest.mock('../createSocketConnector', () => ({
    createSocketConnector: jest.fn(() => {
        return new Observable<GetSocketResponses<string>>(observer => {
            const current: IFakeSocket = {observer, server: new Subject<string>(), sent: []};

            socket = current;
            opened++;

            if (connectorMode === 'pending') {
                return () => undefined;
            }

            const subscriptions: { unsubscribe: () => void }[] = [];

            observer.next(input => {
                subscriptions.push(input.subscribe(data => {
                    current.sent.push(data);
                }));

                return current.server;
            });

            return () => {
                subscriptions.forEach(subscription => subscription.unsubscribe());
            };
        });
    }),
}));

const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    request: jest.fn(),
    response: jest.fn(),
    event: jest.fn(),
    getLogs: jest.fn(),
};

const codec: ITransportCodec<ISocketMessage> = {
    encode: jest.fn(message => JSON.stringify(message)),
    decode: jest.fn(data => JSON.parse(data as string) as ISocketMessage),
};

const createSubject = () => {
    const adapter = createSocketAdapter<ISocketMessage>({
        prefix: 'TEST',
        url: 'ws://localhost:8080',
        protocol: 'ws',
        codec,
        getMessageName: message => `Message_${message.payloadType}`,
        logger: mockLogger as any,
    });

    const transport = createTransport<'socket', ISocketMessage>('socket', adapter, mockLogger as any);

    return {adapter, transport};
};

// Mirrors createSocketConnector on a clean close: both the connection and its message stream complete.
const closeSocket = () => {
    socket!.observer.complete();
    socket!.server.complete();
};

const request: ISocketMessage = {
    payloadType: 1,
    clientMsgId: 'msg-1',
    payload: {data: 'test'},
};

const closedConnection = expect.objectContaining({errorCode: 'ClosedConnection'});

describe('socket transport on connection loss', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        socket = undefined;
        opened = 0;
        connectorMode = 'open';
    });

    it('replays the current state to a late subscriber of state$', () => {
        const {transport} = createSubject();

        // A long-lived subscriber (an app's connection indicator) keeps the stream hot.
        const early = transport.state$.subscribe();

        transport.connect();

        const seen: TransportState[] = [];
        const late = transport.state$.subscribe(state => seen.push(state));

        expect(seen).toEqual([TransportState.Connected]);

        early.unsubscribe();
        late.unsubscribe();
    });

    it('fails a request sent while disconnected at once with ClosedConnection', async () => {
        const {transport} = createSubject();

        const early = transport.state$.subscribe();

        await expect(transport.api.send(request)).rejects.toEqual(closedConnection);
        expect(codec.encode).not.toHaveBeenCalled();

        early.unsubscribe();
    });

    it('fails a request sent after the socket closed at once with ClosedConnection', async () => {
        const {transport} = createSubject();

        const early = transport.state$.subscribe();

        transport.connect();
        closeSocket();

        await expect(transport.api.send(request)).rejects.toEqual(closedConnection);
        expect(socket!.sent).toEqual([]);

        early.unsubscribe();
    });

    it('resolves a request sent while connected with its response', async () => {
        const {transport} = createSubject();

        transport.connect();

        const response = transport.api.send(request);

        expect(socket!.sent).toHaveLength(1);

        socket!.server.next(JSON.stringify({...request, payload: {answer: 42}}));

        await expect(response).resolves.toEqual({answer: 42});
    });

    it('fails a request in flight with ClosedConnection when the socket closes', async () => {
        const {transport} = createSubject();

        transport.connect();

        const response = transport.api.send(request);

        closeSocket();

        await expect(response).rejects.toEqual(closedConnection);
    });

    it('fails a request in flight with ClosedConnection when the socket errors', async () => {
        const {transport} = createSubject();

        transport.connect();

        const response = transport.api.send(request);

        socket!.observer.error({errorCode: 'SocketError'});

        await expect(response).rejects.toEqual(closedConnection);
    });

    it('sends again after a reconnect', async () => {
        const {transport} = createSubject();

        transport.connect();
        closeSocket();
        transport.connect();

        const response = transport.api.send(request);

        socket!.server.next(JSON.stringify({...request, payload: {ok: true}}));

        await expect(response).resolves.toEqual({ok: true});
    });

    it('reports Disconnected after disconnect()', () => {
        const {transport} = createSubject();

        const seen: TransportState[] = [];
        const subscription = transport.state$.subscribe(state => seen.push(state));

        transport.connect();
        transport.disconnect();

        expect(seen).toEqual([
            TransportState.Disconnected, TransportState.Connecting, TransportState.Connected, TransportState.Disconnected,
        ]);

        subscription.unsubscribe();
    });

    it('does not report Disconnected twice when disconnect() is called while already disconnected', () => {
        const {transport} = createSubject();

        const seen: TransportState[] = [];
        const subscription = transport.state$.subscribe(state => seen.push(state));

        transport.disconnect();
        transport.connect();
        closeSocket();
        transport.disconnect();

        expect(seen).toEqual([
            TransportState.Disconnected, TransportState.Connecting, TransportState.Connected, TransportState.Disconnected,
        ]);

        subscription.unsubscribe();
    });

    it('fails a request in flight with ClosedConnection on disconnect()', async () => {
        const {transport} = createSubject();

        transport.connect();

        const response = transport.api.send(request);

        transport.disconnect();

        await expect(response).rejects.toEqual(closedConnection);
    });

    it('opens one connection when connect() is called twice', () => {
        const {transport} = createSubject();

        transport.connect();
        const first = socket;
        transport.connect();

        expect(opened).toBe(1);
        expect(socket).toBe(first);
        expect(first!.observer.closed).toBe(false);
    });

    it('opens a new connection on connect() after disconnect()', async () => {
        const {transport} = createSubject();

        transport.connect();
        const first = socket;
        transport.disconnect();
        transport.connect();

        expect(socket).not.toBe(first);

        const response = transport.api.send(request);

        socket!.server.next(JSON.stringify({...request, payload: {ok: true}}));

        await expect(response).resolves.toEqual({ok: true});
    });

    it('reports Connecting while the socket opens and Disconnected when it never opens', () => {
        const {adapter} = createSubject();

        const seen: TransportState[] = [];
        const subscription = adapter.state$.subscribe(state => seen.push(state));

        connectorMode = 'pending';
        adapter.connect();

        expect(seen).toEqual([TransportState.Disconnected, TransportState.Connecting]);

        socket!.observer.error({errorCode: 'SocketError'});

        expect(seen).toEqual([TransportState.Disconnected, TransportState.Connecting, TransportState.Disconnected]);

        subscription.unsubscribe();
    });

    it('reads a url given as a function at every connect', () => {
        const {createSocketConnector} = jest.requireMock('../createSocketConnector');
        let url = 'ws://first.example.test';

        const adapter = createSocketAdapter<ISocketMessage>({
            prefix: 'TEST',
            url: () => url,
            protocol: 'ws',
            codec,
            getMessageName: message => `Message_${message.payloadType}`,
            logger: mockLogger as any,
        });

        adapter.connect();
        adapter.disconnect();
        url = 'ws://second.example.test';
        adapter.connect();

        expect(createSocketConnector.mock.calls.map((call: unknown[]) => call[0])).toEqual([
            'ws://first.example.test', 'ws://second.example.test',
        ]);
    });

    it('reads a push whose clientMsgId is an Object.prototype name as an event, not a reply', () => {
        const {adapter} = createSubject();
        const events: ISocketMessage[] = [];
        const replies: ISocketMessage[] = [];

        adapter.event$!.subscribe(message => events.push(message));
        adapter.data$.subscribe(message => replies.push(message));
        adapter.connect();

        for (const clientMsgId of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
            socket!.server.next(JSON.stringify({payloadType: 9, payload: {}, clientMsgId}));
        }

        expect(events.map(message => message.clientMsgId)).toEqual(['constructor', 'toString', '__proto__', 'hasOwnProperty']);
        expect(replies).toEqual([]);
    });

    it('throws ClosedConnection from adapter.send while disconnected instead of dropping the message', () => {
        const {adapter} = createSubject();

        expect(() => adapter.send(request)).toThrow();

        try {
            adapter.send(request);
        } catch (error) {
            expect(error).toEqual(closedConnection);
        }

        expect(codec.encode).not.toHaveBeenCalled();
    });
});
