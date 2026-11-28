import {BehaviorSubject, Subject} from 'rxjs';
import {createConnectionSupervisor} from '../createConnectionSupervisor';
import {ConnectionEvent, ConnectionPhase, DropReason, IConnectionSupervisorParams, IRouteStorage} from '../supervisor.interface';
import {ITransportAdapter, TransportState} from '../../interfaces';
import {ISocketMessage} from '../../socket/socket.interface';
import {createTransport} from '../../createTransport';

let nextId = 0;

jest.mock('../../_helpers/createMessageId', () => ({createMessageId: () => `id-${++nextId}`}));

const livenessType = 9;

const createFakeAdapter = () => {
    const state$ = new BehaviorSubject<TransportState>(TransportState.Disconnected);
    const data$ = new Subject<ISocketMessage>();
    const sent: ISocketMessage[] = [];
    let connects = 0;

    const adapter: ITransportAdapter<ISocketMessage, ISocketMessage, ISocketMessage> = {
        data$: data$.asObservable(),
        event$: new Subject<ISocketMessage>().asObservable(),
        state$: state$.asObservable(),
        send: message => {
            if (state$.getValue() !== TransportState.Connected) {
                throw {errorCode: 'ClosedConnection'};
            }

            sent.push(message);
        },
        add: () => undefined,
        drop: () => undefined,
        connect: () => {
            if (state$.getValue() !== TransportState.Disconnected) {
                return;
            }

            connects++;
            state$.next(TransportState.Connecting);
        },
        disconnect: () => {
            if (state$.getValue() !== TransportState.Disconnected) {
                state$.next(TransportState.Disconnected);
            }
        },
    };

    return {
        adapter,
        sent,
        get connects() {
            return connects;
        },
        state: () => state$.getValue(),
        open: () => state$.next(TransportState.Connected),
        // A dial that never opened, or an open socket that closed on its own.
        close: () => state$.next(TransportState.Disconnected),
        reply: (message: ISocketMessage) => data$.next(message),
        livenessFrames: () => sent.filter(message => message.payloadType === livenessType),
    };
};

type IFake = ReturnType<typeof createFakeAdapter>;

const setup = (params: Partial<IConnectionSupervisorParams<ISocketMessage>> = {}, fake: IFake = createFakeAdapter()) => {
    const supervisor = createConnectionSupervisor<ISocketMessage>({
        adapter: fake.adapter,
        random: () => 0,
        ...params,
    });

    const events: ConnectionEvent<ISocketMessage>[] = [];
    supervisor.events$.subscribe(event => events.push(event));

    const states: TransportState[] = [];
    supervisor.state$.subscribe(state => states.push(state));

    return {supervisor, fake, events, states};
};

const liveness = {frame: () => ({payloadType: livenessType, payload: {}}), interval: 15_000, timeout: 10_000};

const echo = (fake: IFake) => {
    const frames = fake.livenessFrames();
    const last = frames[frames.length - 1];

    fake.reply({payloadType: livenessType, payload: {}, clientMsgId: last.clientMsgId});
};

const ofType = <T extends ConnectionEvent<ISocketMessage>['type']>(events: ConnectionEvent<ISocketMessage>[], type: T) => {
    return events.filter(event => event.type === type) as Extract<ConnectionEvent<ISocketMessage>, {type: T}>[];
};

describe('connection supervisor', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(1_000_000);
        nextId = 0;
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('dialing and redialing', () => {
        it('dials at once on connect(), without a timer', () => {
            const {supervisor, fake, states} = setup();

            supervisor.connect();

            expect(fake.connects).toBe(1);
            expect(supervisor.getStatus().phase).toBe(ConnectionPhase.Dialing);

            fake.open();

            expect(states).toEqual([TransportState.Disconnected, TransportState.Connecting, TransportState.Connected]);
            expect(supervisor.getStatus().phase).toBe(ConnectionPhase.Open);
            expect(supervisor.getStatus().generation).toBe(1);
        });

        it('opens one connection however often connect() is called', () => {
            const {supervisor, fake} = setup();

            supervisor.connect();
            supervisor.connect();
            fake.open();
            supervisor.connect();

            expect(fake.connects).toBe(1);
        });

        it('redials a connection that closed on its own after minDelay', () => {
            const {supervisor, fake, events} = setup();

            supervisor.connect();
            fake.open();
            fake.close();

            expect(ofType(events, 'dropped')[0]).toMatchObject({reason: DropReason.Closed});
            expect(supervisor.getStatus().phase).toBe(ConnectionPhase.Waiting);

            jest.advanceTimersByTime(999);
            expect(fake.connects).toBe(1);

            jest.advanceTimersByTime(1);
            expect(fake.connects).toBe(2);
        });

        it('grows the delay of failed dials by factor up to maxDelay', () => {
            const {supervisor, fake, events} = setup({reconnect: {minDelay: 1000, maxDelay: 5000, factor: 2}});

            supervisor.connect();

            for (let i = 0; i < 5; i++) {
                fake.close();
                jest.runOnlyPendingTimers();
            }

            expect(ofType(events, 'retryScheduled').map(event => event.delay)).toEqual([1000, 2000, 4000, 5000, 5000]);
        });

        it('takes up to the jitter share off the delay', () => {
            const {supervisor, fake, events} = setup({random: () => 1, reconnect: {minDelay: 1000, jitter: 0.5}});

            supervisor.connect();
            fake.close();

            expect(ofType(events, 'retryScheduled')[0].delay).toBe(500);
        });

        it('resets the row of failures once a connection stays open for stableAfter', () => {
            const {supervisor, fake, events} = setup({reconnect: {minDelay: 1000, stableAfter: 10_000}});

            supervisor.connect();
            fake.close();
            jest.runOnlyPendingTimers();
            fake.close();
            jest.runOnlyPendingTimers();

            // Two failures behind it: a connection that closes before it proved itself keeps the row growing.
            fake.open();
            jest.advanceTimersByTime(9_000);
            fake.close();

            expect(ofType(events, 'retryScheduled').map(event => event.delay)).toEqual([1000, 2000, 4000]);

            jest.runOnlyPendingTimers();
            fake.open();
            jest.advanceTimersByTime(10_000);
            fake.close();

            expect(ofType(events, 'retryScheduled').pop()!.delay).toBe(1000);
        });

        it('gives up after maxAttempts failed dials in a row, and wake() dials again', () => {
            const {supervisor, fake, events} = setup({reconnect: {maxAttempts: 2}});

            supervisor.connect();
            fake.close();
            jest.runOnlyPendingTimers();
            fake.close();

            expect(ofType(events, 'gaveUp')).toHaveLength(1);
            expect(supervisor.getStatus().phase).toBe(ConnectionPhase.GaveUp);

            jest.advanceTimersByTime(60_000);
            expect(fake.connects).toBe(2);

            supervisor.wake();
            expect(fake.connects).toBe(3);
        });

        it('does not count a drop of an open connection against maxAttempts', () => {
            const {supervisor, fake, events} = setup({reconnect: {maxAttempts: 1}});

            supervisor.connect();
            fake.open();
            fake.close();

            expect(ofType(events, 'gaveUp')).toHaveLength(0);
            jest.runOnlyPendingTimers();
            expect(fake.connects).toBe(2);
        });
    });

    describe('deliberate disconnect', () => {
        it('never redials after disconnect()', () => {
            const {supervisor, fake, events, states} = setup();

            supervisor.connect();
            fake.open();
            supervisor.disconnect();

            jest.advanceTimersByTime(10 * 60_000);

            expect(fake.connects).toBe(1);
            expect(fake.state()).toBe(TransportState.Disconnected);
            expect(states[states.length - 1]).toBe(TransportState.Disconnected);
            expect(ofType(events, 'dropped')).toEqual([expect.objectContaining({reason: DropReason.Deliberate})]);
            expect(supervisor.getStatus().phase).toBe(ConnectionPhase.Stopped);
        });

        it('cancels a pending redial on disconnect()', () => {
            const {supervisor, fake} = setup();

            supervisor.connect();
            fake.close();
            supervisor.disconnect();
            jest.advanceTimersByTime(60_000);

            expect(fake.connects).toBe(1);
        });

        it('abandons a dial under way on disconnect()', () => {
            const {supervisor, fake} = setup();

            supervisor.connect();
            supervisor.disconnect();
            jest.advanceTimersByTime(60_000);

            expect(fake.state()).toBe(TransportState.Disconnected);
            expect(fake.connects).toBe(1);
        });

        it('fails a request in flight with ClosedConnection on disconnect()', async () => {
            const {supervisor, fake} = setup();
            const transport = createTransport({type: 'server', adapter: supervisor, logger: {getLogs: jest.fn()} as any});

            supervisor.connect();
            fake.open();

            const response = transport.api.send({payloadType: 1, payload: {}, clientMsgId: 'r-1'});

            supervisor.disconnect();

            await expect(response).rejects.toMatchObject({errorCode: 'ClosedConnection'});
        });

        it('dials at once with a fresh row of failures on connect() after disconnect()', () => {
            const {supervisor, fake, events} = setup();

            supervisor.connect();
            fake.close();
            jest.runOnlyPendingTimers();
            fake.close();
            supervisor.disconnect();

            supervisor.connect();
            expect(fake.connects).toBe(3);

            fake.close();
            expect(ofType(events, 'retryScheduled').pop()!.delay).toBe(1000);
        });

        it('never dials again after dispose()', () => {
            const {supervisor, fake} = setup();

            supervisor.connect();
            fake.open();
            supervisor.dispose();
            supervisor.connect();
            supervisor.reconnect();
            supervisor.wake();
            jest.advanceTimersByTime(60_000);

            expect(fake.connects).toBe(1);
        });
    });

    describe('reconnect()', () => {
        it('drops an open connection and dials a fresh one at once', () => {
            const {supervisor, fake, events} = setup();

            supervisor.connect();
            fake.open();
            supervisor.reconnect();

            expect(ofType(events, 'dropped')[0]).toMatchObject({reason: DropReason.Restart});
            expect(fake.connects).toBe(2);
            expect(supervisor.getStatus().phase).toBe(ConnectionPhase.Dialing);

            fake.open();
            expect(supervisor.getStatus().generation).toBe(2);
        });

        it('dials at once while waiting out a delay', () => {
            const {supervisor, fake} = setup();

            supervisor.connect();
            fake.close();
            supervisor.reconnect();

            expect(fake.connects).toBe(2);
        });

        it('fails requests in flight on the old connection with ClosedConnection', async () => {
            const {supervisor, fake} = setup();
            const transport = createTransport({type: 'server', adapter: supervisor, logger: {getLogs: jest.fn()} as any});

            supervisor.connect();
            fake.open();

            const response = transport.api.send({payloadType: 1, payload: {}, clientMsgId: 'r-1'});

            supervisor.reconnect();

            await expect(response).rejects.toMatchObject({errorCode: 'ClosedConnection'});
        });
    });

    describe('liveness', () => {
        it('probes as soon as the connection opens and then every interval', () => {
            const {supervisor, fake, events} = setup({liveness});

            supervisor.connect();
            fake.open();

            jest.advanceTimersByTime(0);
            expect(fake.livenessFrames()).toHaveLength(1);
            expect(fake.livenessFrames()[0]).toMatchObject({payloadType: livenessType, payload: {}});

            jest.advanceTimersByTime(40);
            echo(fake);

            expect(ofType(events, 'alive')).toEqual([expect.objectContaining({rtt: 40})]);

            jest.advanceTimersByTime(14_960);
            expect(fake.livenessFrames()).toHaveLength(2);
        });

        it('reads the server clock from the echo, paired with the middle of the round trip', () => {
            const serverTime = Date.UTC(2030, 0, 15, 12, 0, 0);
            const {supervisor, fake, events} = setup({
                liveness: {...liveness, serverTime: message => (message.payload as {serverTime?: unknown}).serverTime},
            });

            supervisor.connect();
            fake.open();
            jest.advanceTimersByTime(0);
            const sentAt = Date.now();

            jest.advanceTimersByTime(40);
            fake.reply({payloadType: livenessType, payload: {serverTime}, clientMsgId: fake.livenessFrames()[0].clientMsgId});

            expect(ofType(events, 'alive')).toEqual([expect.objectContaining({rtt: 40, clock: {serverTime, localTime: sentAt + 20}})]);
        });

        it('gives no clock for an echo without a server time, and none without the reader', () => {
            const {supervisor, fake, events} = setup({
                liveness: {...liveness, serverTime: message => (message.payload as {serverTime?: unknown}).serverTime},
            });

            supervisor.connect();
            fake.open();
            jest.advanceTimersByTime(0);
            fake.reply({payloadType: 50, payload: {errorCode: 'UNKNOWN_MESSAGE'}, clientMsgId: fake.livenessFrames()[0].clientMsgId});

            const plain = setup({liveness});

            plain.supervisor.connect();
            plain.fake.open();
            jest.advanceTimersByTime(0);
            plain.fake.reply({payloadType: livenessType, payload: {serverTime: 1}, clientMsgId: plain.fake.livenessFrames()[0].clientMsgId});

            expect(ofType(events, 'alive')).toHaveLength(1);
            expect(ofType(events, 'alive')[0]).not.toHaveProperty('clock');
            expect(ofType(plain.events, 'alive')).toHaveLength(1);
            expect(ofType(plain.events, 'alive')[0]).not.toHaveProperty('clock');
        });

        it('drops a connection whose echo does not come in time as Stalled and redials it', () => {
            const {supervisor, fake, events} = setup({liveness});

            supervisor.connect();
            fake.open();
            jest.advanceTimersByTime(0);
            jest.advanceTimersByTime(10_000);

            expect(ofType(events, 'dropped')).toEqual([expect.objectContaining({reason: DropReason.Stalled})]);
            expect(fake.state()).toBe(TransportState.Disconnected);

            jest.runOnlyPendingTimers();
            expect(fake.connects).toBe(2);
        });

        it('says Held, not Stalled, when the timer fired far later than set', () => {
            const {supervisor, fake, events} = setup({liveness});

            supervisor.connect();
            fake.open();
            jest.advanceTimersByTime(0);

            // The whole app was frozen for half a minute: the clock moved, the timers did not.
            jest.setSystemTime(Date.now() + 30_000);
            jest.advanceTimersByTime(10_000);

            expect(ofType(events, 'dropped')).toEqual([expect.objectContaining({reason: DropReason.Held})]);
        });

        it('keeps one probe in flight however often it is asked for', () => {
            const {supervisor, fake} = setup({liveness});

            supervisor.connect();
            fake.open();
            jest.advanceTimersByTime(0);
            supervisor.probe();
            supervisor.probe();

            expect(fake.livenessFrames()).toHaveLength(1);

            echo(fake);
            supervisor.probe();

            expect(fake.livenessFrames()).toHaveLength(2);
        });

        it('keeps one probe timer across any number of reconnects', () => {
            const {supervisor, fake} = setup({liveness});

            supervisor.connect();

            for (let i = 0; i < 3; i++) {
                fake.open();
                jest.advanceTimersByTime(0);
                echo(fake);
                fake.close();
                jest.runOnlyPendingTimers();
            }

            fake.open();
            jest.advanceTimersByTime(0);
            echo(fake);

            const before = fake.livenessFrames().length;

            jest.advanceTimersByTime(15_000);

            expect(fake.livenessFrames().length - before).toBe(1);
        });

        it('stops probing once the connection is gone', () => {
            const {supervisor, fake} = setup({liveness});

            supervisor.connect();
            fake.open();
            jest.advanceTimersByTime(0);
            echo(fake);
            supervisor.disconnect();

            jest.advanceTimersByTime(60_000);

            expect(fake.livenessFrames()).toHaveLength(1);
        });

        it('takes an error reply for an answer', () => {
            const {supervisor, fake, events} = setup({liveness});

            supervisor.connect();
            fake.open();
            jest.advanceTimersByTime(0);
            fake.reply({payloadType: 50, payload: {errorCode: 'UNKNOWN_MESSAGE'}, clientMsgId: fake.livenessFrames()[0].clientMsgId});
            jest.advanceTimersByTime(10_000);

            expect(ofType(events, 'alive')).toHaveLength(1);
            expect(ofType(events, 'dropped')).toHaveLength(0);
        });
    });

    describe('online, offline and the foreground', () => {
        it('does not dial while offline and dials at once when online again', () => {
            const {supervisor, fake} = setup();

            supervisor.connect();
            fake.close();
            supervisor.setOnline(false);

            expect(supervisor.getStatus().phase).toBe(ConnectionPhase.Offline);
            jest.advanceTimersByTime(60_000);
            expect(fake.connects).toBe(1);

            supervisor.setOnline(true);
            expect(fake.connects).toBe(2);
        });

        it('waits for the network when connect() is called offline', () => {
            const {supervisor, fake} = setup();

            supervisor.setOnline(false);
            supervisor.connect();

            expect(fake.connects).toBe(0);

            supervisor.setOnline(true);
            expect(fake.connects).toBe(1);
        });

        it('probes an open connection on an offline report instead of dropping it', () => {
            const {supervisor, fake} = setup({liveness});

            supervisor.connect();
            fake.open();
            jest.advanceTimersByTime(0);
            echo(fake);
            supervisor.setOnline(false);

            expect(fake.livenessFrames()).toHaveLength(2);
            expect(fake.state()).toBe(TransportState.Connected);
        });

        it('dials at once on a return to the foreground while waiting', () => {
            const {supervisor, fake} = setup({reconnect: {minDelay: 30_000}});

            supervisor.connect();
            fake.close();
            supervisor.setForeground(false);
            supervisor.setForeground(true);

            expect(fake.connects).toBe(2);
        });

        it('probes an open connection on a return to the foreground', () => {
            const {supervisor, fake} = setup({liveness});

            supervisor.connect();
            fake.open();
            jest.advanceTimersByTime(0);
            echo(fake);
            supervisor.setForeground(true);

            expect(fake.livenessFrames()).toHaveLength(2);
        });

        it('leaves a dial under way alone on wake()', () => {
            const {supervisor, fake} = setup();

            supervisor.connect();
            supervisor.wake();

            expect(fake.connects).toBe(1);
        });

        it('does nothing on wake() while stopped', () => {
            const {supervisor, fake} = setup();

            supervisor.wake();
            supervisor.setForeground(true);
            supervisor.setOnline(true);

            expect(fake.connects).toBe(0);
        });
    });

    describe('addresses', () => {
        const addresses = ['wss://api.example.test/ws', 'wss://relay.example.test/ws'];

        const routed = (params: Partial<IConnectionSupervisorParams<ISocketMessage>> = {}) => {
            const dialed: string[] = [];
            const subject = setup({addresses, useAddress: address => dialed.push(address), ...params});

            return {...subject, dialed};
        };

        const memoryStorage = (initial: Record<string, string> = {}): IRouteStorage & {data: Record<string, string>} => {
            const data = {...initial};

            return {
                data,
                read: key => data[key],
                write: (key, value) => {
                    if (value === undefined) {
                        delete data[key];
                    } else {
                        data[key] = value;
                    }
                },
            };
        };

        it('dials the primary first', () => {
            const {supervisor, dialed} = routed();

            supervisor.connect();

            expect(dialed).toEqual([addresses[0]]);
        });

        it('moves to the fallback after failuresToLeave failures of the primary within the window, and saves it', () => {
            const storage = memoryStorage();
            const {supervisor, fake, dialed, events} = routed({routing: {storage}});

            supervisor.connect();
            fake.close();
            jest.runOnlyPendingTimers();
            fake.close();
            jest.runOnlyPendingTimers();

            expect(dialed).toEqual([addresses[0], addresses[0], addresses[1]]);
            expect(ofType(events, 'route')).toEqual([{type: 'route', address: addresses[1], index: 1}]);
            expect(JSON.parse(storage.data['transport.route'])).toEqual({
                address: addresses[1],
                until: expect.any(Number),
            });
        });

        it('counts a stalled open connection as a failure of its address', () => {
            const {supervisor, fake, dialed} = routed({liveness, reconnect: {stableAfter: 1_000_000}});

            supervisor.connect();

            for (let i = 0; i < 2; i++) {
                fake.open();
                jest.advanceTimersByTime(0);
                jest.advanceTimersByTime(10_000);
                jest.runOnlyPendingTimers();
            }

            expect(dialed[dialed.length - 1]).toBe(addresses[1]);
        });

        it('does not count a held or a plain close against the address', () => {
            const {supervisor, fake, dialed} = routed({liveness});

            supervisor.connect();

            for (let i = 0; i < 2; i++) {
                fake.open();
                jest.advanceTimersByTime(0);
                jest.setSystemTime(Date.now() + 30_000);
                jest.advanceTimersByTime(10_000);
                jest.runOnlyPendingTimers();
            }

            for (let i = 0; i < 2; i++) {
                fake.open();
                fake.close();
                jest.runOnlyPendingTimers();
            }

            expect(dialed).toHaveLength(5);

            expect(dialed.every(address => address === addresses[0])).toBe(true);
        });

        it('stays on the primary when its failures are further apart than the window', () => {
            const {supervisor, fake, dialed} = routed({routing: {failureWindow: 60_000}});

            supervisor.connect();
            fake.close();
            jest.runOnlyPendingTimers();
            fake.open();
            jest.advanceTimersByTime(61_000);
            fake.close();
            jest.runOnlyPendingTimers();
            fake.close();
            jest.runOnlyPendingTimers();

            expect(dialed.slice(0, 3)).toEqual([addresses[0], addresses[0], addresses[0]]);
        });

        it('goes back to the primary after failuresToReturn failures in a row on the fallback', () => {
            const storage = memoryStorage();
            const {supervisor, fake, dialed} = routed({routing: {storage, failuresToLeave: 1, failuresToReturn: 2}});

            supervisor.connect();
            fake.close();
            jest.runOnlyPendingTimers();
            fake.close();
            jest.runOnlyPendingTimers();
            fake.close();
            jest.runOnlyPendingTimers();

            expect(dialed).toEqual([addresses[0], addresses[1], addresses[1], addresses[0]]);
            expect(storage.data['transport.route']).toBeUndefined();
        });

        it('tries the primary again once retryPrimaryAfter has passed', () => {
            const {supervisor, fake, dialed} = routed({routing: {failuresToLeave: 1, retryPrimaryAfter: 60_000}});

            supervisor.connect();
            fake.close();
            jest.runOnlyPendingTimers();
            fake.open();
            jest.advanceTimersByTime(61_000);
            fake.close();
            jest.runOnlyPendingTimers();

            expect(dialed).toEqual([addresses[0], addresses[1], addresses[0]]);
        });

        it('starts on a saved fallback whose term is not over', () => {
            const storage = memoryStorage({
                'transport.route': JSON.stringify({address: addresses[1], until: Date.now() + 60_000}),
            });
            const {supervisor, dialed} = routed({routing: {storage}});

            supervisor.connect();

            expect(dialed).toEqual([addresses[1]]);
        });

        it('ignores a saved fallback whose term is over or that is not in the list', () => {
            for (const saved of [
                {address: addresses[1], until: Date.now() - 1},
                {address: 'wss://other.example.test/ws', until: Date.now() + 60_000},
            ]) {
                const storage = memoryStorage({'transport.route': JSON.stringify(saved)});
                const {supervisor, dialed} = routed({routing: {storage}});

                supervisor.connect();

                expect(dialed).toEqual([addresses[0]]);
            }
        });

        it('waits for an async storage before the first dial', async () => {
            let resolve: (value: string) => void = () => undefined;
            const storage: IRouteStorage = {
                read: () => new Promise<string>(done => {
                    resolve = done;
                }),
                write: () => undefined,
            };
            const {supervisor, fake, dialed} = routed({routing: {storage}});

            supervisor.connect();
            expect(fake.connects).toBe(0);

            resolve(JSON.stringify({address: addresses[1], until: Date.now() + 60_000}));
            await Promise.resolve();
            await Promise.resolve();

            expect(dialed).toEqual([addresses[1]]);
        });

        it('does not dial after a stop while the storage is read', async () => {
            let resolve: (value: undefined) => void = () => undefined;
            const storage: IRouteStorage = {
                read: () => new Promise<undefined>(done => {
                    resolve = done;
                }),
                write: () => undefined,
            };
            const {supervisor, fake} = routed({routing: {storage}});

            supervisor.connect();
            supervisor.disconnect();
            resolve(undefined);
            await Promise.resolve();
            await Promise.resolve();

            expect(fake.connects).toBe(0);
        });

        it('keeps dialing when the storage throws', () => {
            const storage: IRouteStorage = {
                read: () => {
                    throw new Error('broken');
                },
                write: () => {
                    throw new Error('broken');
                },
            };
            const {supervisor, fake, dialed} = routed({routing: {storage, failuresToLeave: 1}});

            supervisor.connect();
            fake.close();
            jest.runOnlyPendingTimers();

            expect(dialed).toEqual([addresses[0], addresses[1]]);
        });
    });
});
