import {BehaviorSubject, Subject} from 'rxjs';
import {createTransport, defaultRequestTimeout} from '../createTransport';
import {ITransportAdapter, TransportErrorCode, TransportState} from '../interfaces';
import {ISocketMessage} from '../socket/socket.interface';
import {isClosedConnection, isRequestTimeout, isTransportError} from '../errors';

jest.mock('../_helpers/createMessageId', () => ({createMessageId: () => 'generated-id'}));

const logger = {getLogs: jest.fn()} as any;

const createAdapter = () => {
    const data$ = new Subject<ISocketMessage>();
    const pending = new Set<string>();

    const adapter: ITransportAdapter<ISocketMessage, ISocketMessage, ISocketMessage> = {
        data$,
        state$: new BehaviorSubject(TransportState.Connected),
        send: () => undefined,
        add: clientMsgId => pending.add(clientMsgId),
        drop: clientMsgId => pending.delete(clientMsgId),
        connect: () => undefined,
        disconnect: () => undefined,
    };

    return {adapter, data$, pending};
};

const request: ISocketMessage = {payloadType: 1, payload: {}, clientMsgId: 'r-1'};

describe('request timeout', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('fails a request with no reply with RequestTimeout after the default timeout and forgets it', async () => {
        const {adapter, pending} = createAdapter();
        const transport = createTransport({type: 'server', adapter, logger});

        const response = transport.api.send(request);
        const settled = jest.fn();
        response.catch(settled);

        jest.advanceTimersByTime(defaultRequestTimeout - 1);
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);

        await expect(response).rejects.toMatchObject({errorCode: TransportErrorCode.RequestTimeout});
        expect(pending.has('r-1')).toBe(false);
    });

    it('resolves a reply that comes in time', async () => {
        const {adapter, data$} = createAdapter();
        const transport = createTransport({type: 'server', adapter, logger});

        const response = transport.api.send(request);

        jest.advanceTimersByTime(1000);
        data$.next({payloadType: 2, payload: {ok: true}, clientMsgId: 'r-1'});

        await expect(response).resolves.toEqual({ok: true});
    });

    it('takes the transport timeout from the options and a per-request one over it', async () => {
        const {adapter} = createAdapter();
        const transport = createTransport({type: 'server', adapter, logger, requestTimeout: 1000});

        const short = transport.api.send({...request, clientMsgId: 'r-short'});
        const long = transport.api.send({...request, clientMsgId: 'r-long'}, {timeout: 5000});
        const longSettled = jest.fn();
        long.catch(longSettled);

        jest.advanceTimersByTime(1000);
        await expect(short).rejects.toMatchObject({errorCode: TransportErrorCode.RequestTimeout});
        expect(longSettled).not.toHaveBeenCalled();

        jest.advanceTimersByTime(4000);
        await expect(long).rejects.toMatchObject({errorCode: TransportErrorCode.RequestTimeout});
    });

    it('waits for ever with a timeout of 0 and in the positional form', async () => {
        const {adapter, data$} = createAdapter();
        const forever = createTransport({type: 'server', adapter, logger, requestTimeout: 0});
        const positional = createTransport('server', adapter, logger);

        const first = forever.api.send({...request, clientMsgId: 'a'});
        const second = positional.api.send({...request, clientMsgId: 'b'});

        jest.advanceTimersByTime(10 * defaultRequestTimeout);

        data$.next({payloadType: 2, payload: {n: 1}, clientMsgId: 'a'});
        data$.next({payloadType: 2, payload: {n: 2}, clientMsgId: 'b'});

        await expect(first).resolves.toEqual({n: 1});
        await expect(second).resolves.toEqual({n: 2});
    });

    it('rejects an error reply with its payload, as before', async () => {
        const {adapter, data$} = createAdapter();
        const transport = createTransport({
            type: 'server', adapter, logger, isError: message => message.payloadType === 50,
        });

        const response = transport.api.send(request);
        data$.next({payloadType: 50, payload: {errorCode: 'NOPE'}, clientMsgId: 'r-1'});

        await expect(response).rejects.toEqual({errorCode: 'NOPE'});
    });

    it('names a failed request without its payload: no secrets in the error, and a payload JSON cannot write still fails as a transport error', async () => {
        const {adapter} = createAdapter();
        const state$ = adapter.state$ as BehaviorSubject<TransportState>;
        const transport = createTransport({type: 'server', adapter, logger});
        const secret: ISocketMessage = {payloadType: 7, payload: {password: 'hunter2', size: BigInt(1)}, clientMsgId: 's-1'};

        const timedOut = transport.api.send(secret);
        jest.advanceTimersByTime(defaultRequestTimeout);
        const timeoutError = await timedOut.catch(error => error);

        const closed = transport.api.send(secret);
        state$.next(TransportState.Disconnected);
        const closedError = await closed.catch(error => error);

        state$.next(TransportState.Disconnected);
        const notSent = await transport.api.send(secret).catch(error => error);

        expect(timeoutError).toMatchObject({errorCode: TransportErrorCode.RequestTimeout});
        expect(closedError).toMatchObject({errorCode: TransportErrorCode.ClosedConnection});
        expect(notSent).toMatchObject({errorCode: TransportErrorCode.ClosedConnection});

        for (const error of [timeoutError, closedError, notSent]) {
            expect(error.description).toContain('7');
            expect(error.description).not.toContain('hunter2');
        }
    });
});

describe('transport error helpers', () => {
    it('tells the transport failures apart from a reply', () => {
        expect(isClosedConnection({errorCode: 'ClosedConnection'})).toBe(true);
        expect(isRequestTimeout({errorCode: 'RequestTimeout'})).toBe(true);
        expect(isTransportError({errorCode: 'RequestTimeout'})).toBe(true);
        expect(isTransportError({errorCode: 'INVALID_REQUEST'})).toBe(false);
        expect(isTransportError(undefined)).toBe(false);
        expect(isTransportError('ClosedConnection')).toBe(false);
    });
});
