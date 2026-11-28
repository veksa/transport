import {BehaviorSubject, catchError, EMPTY, exhaustMap, map, merge, Observable, Subject, Subscription, take, timeout, TimeoutError, timer} from 'rxjs';
import {IMessage, TransportState} from '../interfaces';
import {sendRequest} from '../_helpers/sendRequest';
import {readServerClock} from '../serverClock';
import {getReconnectDelay, reconnectDefaults} from './_helpers/backoff';
import {createRouter} from './_helpers/createRouter';
import {
    ConnectionEvent,
    ConnectionPhase,
    DropReason,
    IConnectionStatus,
    IConnectionSupervisorParams,
    ISupervisedAdapter,
} from './supervisor.interface';

export const livenessDefaults = {
    interval: 15_000,
    timeout: 10_000,
};

/**
 * Owns the life of one connection so that an app does not: dials at once on `connect()`, redials every drop with a
 * growing, jittered delay, probes an open connection with a liveness frame and drops it when the echo does not come,
 * moves to a fallback address when the primary keeps failing, and never redials after a deliberate `disconnect()`.
 *
 * The rules, in order of precedence:
 * - `disconnect()` / `dispose()` stop everything; only `connect()` (not after `dispose()`) starts again.
 * - A drop that was not deliberate is always redialed; a `reconnect()` redials at once.
 * - Attempt n of a row of failures waits `getReconnectDelay(n)`; a connection open for `stableAfter` resets the row.
 * - While offline (`setOnline(false)`) nothing is dialed; online, a return to the foreground and `wake()` dial now.
 * - At most one connection and one dial at a time; at most one probe in flight.
 */
export const createConnectionSupervisor = <Message extends IMessage>(
    params: IConnectionSupervisorParams<Message>,
): ISupervisedAdapter<Message> => {
    const {adapter, addresses, useAddress, liveness} = params;
    const options = {...reconnectDefaults, ...params.reconnect};
    const random = params.random ?? Math.random;
    const livenessInterval = liveness?.interval ?? livenessDefaults.interval;
    const livenessTimeout = liveness?.timeout ?? livenessDefaults.timeout;

    const events$ = new Subject<ConnectionEvent<Message>>();
    const state$ = new BehaviorSubject<TransportState>(TransportState.Disconnected);

    let phase = ConnectionPhase.Stopped;
    let disposed = false;
    let online = true;
    let attempt = 0;
    let generation = 0;
    let openedAt = 0;
    let nextAttemptAt: number | undefined;
    // Set before the supervisor drops the connection itself, read when the adapter reports the drop.
    let dropReason: DropReason | undefined;
    // Counts drops of an open connection, so the supervisor can tell whether the adapter reported its own.
    let drops = 0;
    // Bumped by every start and stop, so a dial waiting for the saved route does not outlive them.
    let run = 0;

    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stableTimer: ReturnType<typeof setTimeout> | undefined;
    let livenessSubscription: Subscription | undefined;
    const probe$ = new Subject<void>();

    const router = createRouter(addresses, params.routing, (address, index) => {
        events$.next({type: 'route', address, index});
    });

    let address: string | undefined = addresses?.[0];

    const getStatus = (): IConnectionStatus => ({
        phase,
        address,
        attempt,
        generation,
        nextAttemptAt: phase === ConnectionPhase.Waiting ? nextAttemptAt : undefined,
    });

    const status$ = new BehaviorSubject<IConnectionStatus>(getStatus());

    const setPhase = (next: ConnectionPhase) => {
        phase = next;
        status$.next(getStatus());
    };

    const setState = (next: TransportState) => {
        if (state$.getValue() !== next) {
            state$.next(next);
        }
    };

    const clearRetry = () => {
        if (retryTimer !== undefined) {
            clearTimeout(retryTimer);
            retryTimer = undefined;
        }

        nextAttemptAt = undefined;
    };

    const clearOpen = () => {
        if (stableTimer !== undefined) {
            clearTimeout(stableTimer);
            stableTimer = undefined;
        }

        livenessSubscription?.unsubscribe();
        livenessSubscription = undefined;
    };

    // The supervisor's own drop: the reason first, so the Disconnected the adapter reports is read with it.
    const drop = (reason: DropReason) => {
        const seen = drops;

        dropReason = reason;
        adapter.disconnect();

        // An adapter that does not report its own disconnect is treated as if it had.
        if (drops === seen && phase === ConnectionPhase.Open) {
            onAdapterState(TransportState.Disconnected);
        }
    };

    const startLiveness = () => {
        if (!liveness) {
            return;
        }

        livenessSubscription = merge(timer(0, livenessInterval), probe$).pipe(
            exhaustMap(() => {
                const sentAt = Date.now();

                return sendRequest<Message>(adapter, {...liveness.frame(), clientMsgId: ''} as Message).pipe(
                    take(1),
                    timeout({first: livenessTimeout}),
                    map(message => {
                        const receivedAt = Date.now();
                        const rtt = receivedAt - sentAt;
                        const clock = liveness.serverTime ? readServerClock(liveness.serverTime(message), receivedAt, rtt) : undefined;

                        return {message, rtt, clock};
                    }),
                    catchError((error: unknown) => {
                        if (error instanceof TimeoutError && phase === ConnectionPhase.Open) {
                            // A timer that fired far later than it was set for: the system held the app, not the network.
                            const held = Date.now() - sentAt > livenessTimeout * 2;

                            drop(held ? DropReason.Held : DropReason.Stalled);
                        }

                        // Anything else is the connection closing under the probe: its drop is already on the way.
                        return EMPTY;
                    }),
                );
            }),
        ).subscribe(({message, rtt, clock}) => {
            // Any reply, the error frame included, is the other side answering.
            events$.next(clock ? {type: 'alive', message, rtt, clock} : {type: 'alive', message, rtt});
        });
    };

    // `afterDial`: the attempt that just failed was a dial, the only kind `maxAttempts` counts.
    const schedule = (afterDial: boolean) => {
        if (phase === ConnectionPhase.Stopped) {
            return;
        }

        if (afterDial && attempt >= options.maxAttempts) {
            setPhase(ConnectionPhase.GaveUp);
            events$.next({type: 'gaveUp', attempt});

            return;
        }

        if (!online) {
            setPhase(ConnectionPhase.Offline);

            return;
        }

        const delay = getReconnectDelay(attempt, options, random);

        clearRetry();
        nextAttemptAt = Date.now() + delay;
        setPhase(ConnectionPhase.Waiting);
        events$.next({type: 'retryScheduled', attempt, delay});

        retryTimer = setTimeout(() => {
            retryTimer = undefined;
            dial();
        }, delay);
    };

    const dial = () => {
        clearRetry();

        if (phase === ConnectionPhase.Stopped || phase === ConnectionPhase.Dialing || phase === ConnectionPhase.Open) {
            return;
        }

        if (!online) {
            setPhase(ConnectionPhase.Offline);

            return;
        }

        address = router.current();

        if (address !== undefined) {
            useAddress?.(address);
        }

        setPhase(ConnectionPhase.Dialing);
        events$.next({type: 'dialing', address, attempt});
        setState(TransportState.Connecting);

        adapter.connect();
    };

    function onAdapterState(next: TransportState) {
        if (phase === ConnectionPhase.Dialing && next === TransportState.Connected) {
            generation++;
            openedAt = Date.now();
            setPhase(ConnectionPhase.Open);
            setState(TransportState.Connected);
            events$.next({type: 'connected', address, generation});

            stableTimer = setTimeout(() => {
                stableTimer = undefined;
                attempt = 0;
                status$.next(getStatus());
            }, options.stableAfter);

            startLiveness();

            return;
        }

        if (next !== TransportState.Disconnected) {
            return;
        }

        if (phase === ConnectionPhase.Dialing) {
            dropReason = undefined;
            setState(TransportState.Disconnected);
            events$.next({type: 'dialFailed', address, attempt});

            router.failed();
            attempt++;
            schedule(true);

            return;
        }

        if (phase === ConnectionPhase.Open) {
            const reason = dropReason ?? DropReason.Closed;
            const openFor = Date.now() - openedAt;

            drops++;
            dropReason = undefined;
            clearOpen();
            // Before the drop is reported: whoever reacts to it already sees a phase that is not Open.
            setPhase(ConnectionPhase.Waiting);
            setState(TransportState.Disconnected);
            events$.next({type: 'dropped', address, reason, openFor});

            router.served(openFor);

            if (reason === DropReason.Stalled) {
                router.failed();
            }

            if (reason === DropReason.Restart) {
                attempt = 0;
                dial();

                return;
            }

            attempt++;
            schedule(false);
        }
    }

    adapter.state$.subscribe(onAdapterState);

    const begin = () => {
        const current = ++run;
        const ready = router.ready;

        setPhase(ConnectionPhase.Waiting);

        if (!ready) {
            dial();

            return;
        }

        // A saved fallback is read before the first dial; a stop meanwhile cancels it.
        void ready.then(() => {
            if (current === run && phase === ConnectionPhase.Waiting && retryTimer === undefined) {
                dial();
            }
        });
    };

    const connect = () => {
        if (disposed) {
            return;
        }

        if (phase === ConnectionPhase.Stopped) {
            attempt = 0;
            begin();

            return;
        }

        // Already supervising: a connect() is a nudge, not a second connection.
        wake();
    };

    const disconnect = () => {
        run++;
        clearRetry();

        const wasOpen = phase === ConnectionPhase.Open;
        const wasDialing = phase === ConnectionPhase.Dialing;
        const openFor = Date.now() - openedAt;

        clearOpen();
        setPhase(ConnectionPhase.Stopped);

        if (wasOpen || wasDialing) {
            adapter.disconnect();
        }

        dropReason = undefined;
        setState(TransportState.Disconnected);

        if (wasOpen) {
            events$.next({type: 'dropped', address, reason: DropReason.Deliberate, openFor});
        }
    };

    const reconnect = () => {
        if (disposed) {
            return;
        }

        switch (phase) {
            case ConnectionPhase.Open:
                drop(DropReason.Restart);

                return;
            case ConnectionPhase.Dialing:
                // The dial under way is abandoned for a fresh one; it is not the address's failure.
                setPhase(ConnectionPhase.Waiting);
                adapter.disconnect();
                attempt = 0;
                dial();

                return;
            case ConnectionPhase.Stopped:
                connect();

                return;
            default:
                attempt = 0;
                dial();
        }
    };

    const wake = () => {
        switch (phase) {
            case ConnectionPhase.Open:
                probe$.next();

                return;
            case ConnectionPhase.GaveUp:
                attempt = 0;
                dial();

                return;
            case ConnectionPhase.Waiting:
            case ConnectionPhase.Offline:
                // Before the saved route is read there is no retry timer yet: the first dial is already coming.
                if (retryTimer !== undefined || phase === ConnectionPhase.Offline) {
                    dial();
                }

                return;
            default:
                return;
        }
    };

    const probe = () => {
        if (phase === ConnectionPhase.Open) {
            probe$.next();
        }
    };

    const setOnline = (next: boolean) => {
        online = next;

        if (next) {
            wake();

            return;
        }

        if (phase === ConnectionPhase.Waiting && retryTimer !== undefined) {
            clearRetry();
            setPhase(ConnectionPhase.Offline);
        }

        // An offline report is a hint, not proof: an open connection is asked rather than dropped.
        probe();
    };

    const setForeground = (foreground: boolean) => {
        if (foreground) {
            wake();
        }
    };

    const dispose = () => {
        disconnect();
        disposed = true;
    };

    return {
        data$: adapter.data$,
        event$: adapter.event$,
        state$: state$.asObservable(),
        send: message => adapter.send(message),
        add: clientMsgId => adapter.add(clientMsgId),
        drop: clientMsgId => adapter.drop(clientMsgId),
        connect,
        disconnect,

        events$: events$.asObservable(),
        status$: status$.asObservable() as Observable<IConnectionStatus>,
        getStatus,
        reconnect,
        wake,
        probe,
        setOnline,
        setForeground,
        dispose,
    };
};
