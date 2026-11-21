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

// uuid ships ESM only, which ts-jest does not transform; requests in this suite carry their own clientMsgId.
jest.mock('uuid', () => ({v4: () => 'generated-id'}));

jest.mock('../createSocketConnector', () => ({
    createSocketConnector: jest.fn(() => {
        return new Observable<GetSocketResponses<string>>(observer => {
            const current: IFakeSocket = {observer, server: new Subject<string>(), sent: []};

            socket = current;

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
