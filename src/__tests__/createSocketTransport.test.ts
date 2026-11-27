import {Observable, Subject, Subscriber} from 'rxjs';
import {createSocketTransport} from '../createSocketTransport';
import {GetSocketResponses} from '../socket/createSocketConnector';
import {ISocketMessage} from '../socket/socket.interface';
import {createJsonCodec} from '../codec/createJsonCodec';
import {DropReason, ConnectionEvent} from '../supervisor/supervisor.interface';
import {TransportState} from '../interfaces';

interface IFakeSocket {
    url: string;
    observer: Subscriber<GetSocketResponses<string>>;
    server: Subject<string>;
    sent: ISocketMessage[];
}

const sockets: IFakeSocket[] = [];

let nextId = 0;

jest.mock('../_helpers/createMessageId', () => ({createMessageId: () => `id-${++nextId}`}));

jest.mock('../socket/createSocketConnector', () => ({
    createSocketConnector: jest.fn((url: string) => {
        return new Observable<GetSocketResponses<string>>(observer => {
            const current: IFakeSocket = {url, observer, server: new Subject<string>(), sent: []};

            sockets.push(current);

            const subscriptions: {unsubscribe: () => void}[] = [];

            return () => {
                subscriptions.forEach(subscription => subscription.unsubscribe());
            };
        });
    }),
}));

// The fake socket opens when the test says so.
const open = (socket: IFakeSocket) => {
    socket.observer.next(input => {
        input.subscribe(data => socket.sent.push(JSON.parse(data)));

        return socket.server;
    });
};

const logger = {info: jest.fn(), error: jest.fn(), request: jest.fn(), response: jest.fn(), event: jest.fn(), getLogs: jest.fn()} as any;

const create = () => createSocketTransport<'server', ISocketMessage>({
    type: 'server',
    url: ['wss://api.example.test/ws', 'wss://relay.example.test/ws'],
    protocol: 'myapp-v1',
    codec: createJsonCodec<ISocketMessage>(),
    logger,
    getMessageName: message => String(message.payloadType),
    prefix: 'S',
    liveness: {payloadType: 7},
    routing: {failuresToLeave: 1},
    random: () => 0,
});

describe('createSocketTransport', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        sockets.length = 0;
        nextId = 0;
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('opens, probes with the liveness frame, and redials a stalled socket on the next address', () => {
        const transport = create();
        const events: ConnectionEvent<ISocketMessage>[] = [];
        transport.events$.subscribe(event => events.push(event));

        transport.connect();
        expect(sockets.map(socket => socket.url)).toEqual(['wss://api.example.test/ws']);

        open(sockets[0]);
        jest.advanceTimersByTime(0);

        expect(sockets[0].sent).toEqual([{payloadType: 7, payload: {}, clientMsgId: 'id-1'}]);

        sockets[0].server.next(JSON.stringify({payloadType: 7, payload: {}, clientMsgId: 'id-1'}));
        expect(events.filter(event => event.type === 'alive')).toHaveLength(1);

        jest.advanceTimersByTime(15_000 + 10_000);

        expect(events).toContainEqual(expect.objectContaining({type: 'dropped', reason: DropReason.Stalled}));

        jest.runOnlyPendingTimers();
        expect(sockets.map(socket => socket.url)).toEqual(['wss://api.example.test/ws', 'wss://relay.example.test/ws']);
    });

    it('stays down after disconnect() and fails a request made then with ClosedConnection', async () => {
        const transport = create();
        const states: TransportState[] = [];
        transport.state$.subscribe(state => states.push(state));

        transport.connect();
        open(sockets[0]);
        transport.disconnect();
        jest.advanceTimersByTime(60_000);

        expect(sockets).toHaveLength(1);
        expect(states[states.length - 1]).toBe(TransportState.Disconnected);
        await expect(transport.api.send({payloadType: 1, payload: {}, clientMsgId: 'r'}))
            .rejects.toMatchObject({errorCode: 'ClosedConnection'});
    });

    it('fails a dial that does not open within the handshake timeout and redials', () => {
        const transport = create();

        transport.connect();
        jest.advanceTimersByTime(5000);

        expect(transport.getStatus().attempt).toBe(1);

        jest.runOnlyPendingTimers();
        expect(sockets).toHaveLength(2);
    });
});
