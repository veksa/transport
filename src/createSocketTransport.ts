import {ILogger} from '@veksa/logger';
import {createSocketAdapter} from './socket/createSocketAdapter';
import {createTransport} from './createTransport';
import {createConnectionSupervisor} from './supervisor/createConnectionSupervisor';
import {IConnectionControl, IReconnectOptions, IRoutingOptions} from './supervisor/supervisor.interface';
import {ITransport, ITransportCodec} from './interfaces';
import {ISocketMessage} from './socket/socket.interface';

export interface ISocketLivenessOptions {
    /** The payloadType of the liveness frame; it goes out with payload `{}` and the other side echoes it. */
    payloadType: number;
    /** ms, default 15000. */
    interval?: number;
    /** ms, default 10000. */
    timeout?: number;
}

export interface ISocketTransportParams<Type extends string, Message extends ISocketMessage> {
    type: Type;
    /** One address, or the primary followed by its fallbacks. */
    url: string | string[];
    protocol: string;
    codec: ITransportCodec<Message>;
    logger: ILogger<Message>;
    getMessageName: (message: ISocketMessage) => string;
    prefix: string;
    prefixColor?: string;
    isError?: (message: Message) => boolean;
    /** ms, default 5000. */
    handshakeTimeout?: number;
    /** ms, default 20000; `0` waits for ever. */
    requestTimeout?: number;
    /** Without it the connection is not probed. */
    liveness?: ISocketLivenessOptions;
    reconnect?: IReconnectOptions;
    routing?: IRoutingOptions;
    random?: () => number;
}

export type ISocketTransport<Type extends string, Message extends ISocketMessage> =
    ITransport<Type, Message, Message, Message> & IConnectionControl<Message>;

/**
 * A socket transport under a connection supervisor: `connect()` starts it and it stays connected — redialing with
 * backoff, probing with the liveness frame, falling back between addresses — until `disconnect()`.
 */
export const createSocketTransport = <Type extends string, Message extends ISocketMessage>(
    params: ISocketTransportParams<Type, Message>,
): ISocketTransport<Type, Message> => {
    const addresses = Array.isArray(params.url) ? params.url : [params.url];

    if (addresses.length === 0) {
        throw new Error('createSocketTransport needs at least one url');
    }

    let address = addresses[0];

    const adapter = createSocketAdapter<Message>({
        prefix: params.prefix,
        prefixColor: params.prefixColor,
        url: () => address,
        protocol: params.protocol,
        codec: params.codec,
        getMessageName: params.getMessageName,
        logger: params.logger,
        handshakeTimeout: params.handshakeTimeout,
    });

    const {liveness} = params;

    const supervisor = createConnectionSupervisor<Message>({
        adapter,
        addresses,
        useAddress: next => {
            address = next;
        },
        reconnect: params.reconnect,
        routing: params.routing,
        random: params.random,
        liveness: liveness
            ? {
                frame: () => ({payloadType: liveness.payloadType, payload: {}}) as Omit<Message, 'clientMsgId'>,
                interval: liveness.interval,
                timeout: liveness.timeout,
            }
            : undefined,
    });

    const transport = createTransport<Type, Message>({
        type: params.type,
        adapter: supervisor,
        logger: params.logger,
        isError: params.isError,
        requestTimeout: params.requestTimeout,
    });

    return {
        ...transport,
        events$: supervisor.events$,
        status$: supervisor.status$,
        getStatus: supervisor.getStatus,
        reconnect: supervisor.reconnect,
        wake: supervisor.wake,
        probe: supervisor.probe,
        setOnline: supervisor.setOnline,
        setForeground: supervisor.setForeground,
        dispose: supervisor.dispose,
    };
};
