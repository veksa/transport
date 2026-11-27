import {Observable} from 'rxjs';
import {IMessage, ITransportAdapter} from '../interfaces';

export interface IReconnectOptions {
    /** The delay before the first retry after a drop or a failed attempt, ms. Default 1000. */
    minDelay?: number;
    /** The cap the delay grows to, ms. Default 30000. */
    maxDelay?: number;
    /** How much the delay grows with every failed attempt in a row. Default 2. */
    factor?: number;
    /**
     * The share of the delay that is random, 0..1: a delay `d` becomes a value in `[d·(1 − jitter), d]`, so clients
     * dropped together by a restarting server do not come back together. Default 0.5.
     */
    jitter?: number;
    /** A connection that stays open this long resets the count of failed attempts, ms. Default 10000. */
    stableAfter?: number;
    /**
     * Failed attempts in a row after which the supervisor stops dialing until `connect()`, `wake()` or a return
     * online. Default `Infinity`.
     */
    maxAttempts?: number;
}

export interface ILivenessOptions<Message extends IMessage> {
    /** The liveness frame, without `clientMsgId`; the other side echoes it with the same `clientMsgId`. */
    frame: () => Omit<Message, 'clientMsgId'>;
    /** How often a probe goes out while connected, ms; the first goes out as soon as the connection opens. Default 15000. */
    interval?: number;
    /** How long the echo may take before the connection is dropped and dialed again, ms. Default 10000. */
    timeout?: number;
}

/** Where the supervisor keeps the chosen fallback address across launches. Either sync or async. */
export interface IRouteStorage {
    read: (key: string) => string | undefined | null | Promise<string | undefined | null>;
    /** `undefined` removes the key. */
    write: (key: string, value: string | undefined) => void | Promise<void>;
}

export interface IRoutingOptions {
    /** Failures of the primary address within `failureWindow` that move the client to the next address. Default 2. */
    failuresToLeave?: number;
    /** The window the primary's failures are counted in, ms; a fallback connection open longer than this is proven. Default 600000. */
    failureWindow?: number;
    /** How long the client stays on a fallback before it tries the primary again, ms. Default 86400000. */
    retryPrimaryAfter?: number;
    /** Failures in a row on a fallback that move the client on (past the last address, back to the primary). Default 3. */
    failuresToReturn?: number;
    /** Keeps the choice across launches; without it every launch starts on the primary. */
    storage?: IRouteStorage;
    /** The storage key. Default `transport.route`. */
    storageKey?: string;
}

export interface IConnectionSupervisorParams<Message extends IMessage> {
    adapter: ITransportAdapter<Message, Message, Message>;
    /**
     * Addresses in order of preference, the first is the primary. Before every dial the supervisor calls
     * `useAddress` with the one to dial; the adapter must read it on connect (`createSocketAdapter`'s `url` as a
     * function). Without `addresses` the adapter dials what it was built with.
     */
    addresses?: string[];
    useAddress?: (address: string) => void;
    reconnect?: IReconnectOptions;
    /** Without it the supervisor does not probe: a connection the network froze is noticed only by its close. */
    liveness?: ILivenessOptions<Message>;
    routing?: IRoutingOptions;
    /** Random source for the jitter, `[0, 1)`. Default `Math.random`. */
    random?: () => number;
}

export enum ConnectionPhase {
    /** Not supervising: never started, `disconnect()`ed or disposed. */
    Stopped = 'Stopped',
    Dialing = 'Dialing',
    Open = 'Open',
    /** Waiting out the backoff delay before the next attempt. */
    Waiting = 'Waiting',
    /** Told the device is offline: no attempts until it is online again. */
    Offline = 'Offline',
    /** `maxAttempts` failed in a row: no attempts until `connect()`, `wake()` or a return online. */
    GaveUp = 'GaveUp',
}

export enum DropReason {
    /** The connection closed on its own (the server, the network). */
    Closed = 'Closed',
    /** The liveness echo did not come in time. */
    Stalled = 'Stalled',
    /**
     * The echo did not come in time, but the timer itself fired far later than set: the system held the whole app
     * (a background, a sleeping device), so the network is not to blame. Not counted against the address.
     */
    Held = 'Held',
    /** `reconnect()`: dropped on purpose to dial a fresh connection at once. */
    Restart = 'Restart',
    /** `disconnect()` or `dispose()`: dropped on purpose, nothing is dialed. */
    Deliberate = 'Deliberate',
}

export type ConnectionEvent<Message extends IMessage> =
    | {type: 'dialing'; address?: string; attempt: number}
    | {type: 'connected'; address?: string; generation: number}
    | {type: 'dialFailed'; address?: string; attempt: number}
    | {type: 'dropped'; address?: string; reason: DropReason; openFor: number}
    | {type: 'retryScheduled'; attempt: number; delay: number}
    | {type: 'gaveUp'; attempt: number}
    | {type: 'alive'; message: Message; rtt: number}
    | {type: 'route'; address: string; index: number};

export interface IConnectionStatus {
    phase: ConnectionPhase;
    /** The address being dialed or open (or about to be dialed). */
    address?: string;
    /** Failed attempts in a row. */
    attempt: number;
    /** Counts opened connections; a new connection is a new value. */
    generation: number;
    /** When the next attempt goes out, while `Waiting` (epoch ms). */
    nextAttemptAt?: number;
}

export interface IConnectionControl<Message extends IMessage> {
    /** Discrete happenings of the connection: what an app turns into its own state (a reachable flag, a clock). */
    events$: Observable<ConnectionEvent<Message>>;
    /** The supervisor's state; replays the current one. */
    status$: Observable<IConnectionStatus>;
    getStatus: () => IConnectionStatus;
    /** Drop the connection (if any) and dial a fresh one now; supervising continues. */
    reconnect: () => void;
    /** Something says the network may be back (a push, an incoming call, a tap): dial now if waiting, probe if open. */
    wake: () => void;
    /** Send a liveness probe now if open (a «check connection» button). */
    probe: () => void;
    /** The device's network state: offline pauses dialing and probes an open connection; online wakes. */
    setOnline: (online: boolean) => void;
    /** The app's visibility: a return to the foreground wakes. */
    setForeground: (foreground: boolean) => void;
    /** Stop for good: disconnect, and `connect()` never dials again. For a store that is thrown away. */
    dispose: () => void;
}

/**
 * An adapter whose `connect()` starts supervising (dial, keep alive, redial on every drop) and whose `disconnect()`
 * stops it: a deliberate disconnect is never redialed. Hand it to `createTransport` like any adapter.
 */
export type ISupervisedAdapter<Message extends IMessage> =
    ITransportAdapter<Message, Message, Message> & IConnectionControl<Message>;
