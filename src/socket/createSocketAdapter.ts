import {BehaviorSubject, defer, race, share, Subject, Subscription, switchMap, throwError, timer} from 'rxjs';
import {createSocketConnector} from './createSocketConnector';
import {catchError, mergeMap} from 'rxjs/operators';
import {ILogger} from '@veksa/logger';
import {ITransportAdapter, ITransportCodec, TransportState} from '../interfaces';
import {ISocketMessage} from './socket.interface';

export const handshakeTimeout = 5000;

export interface ISocketAdapterParams<Message extends ISocketMessage> {
    prefix: string;
    prefixColor?: string;
    /** The address, or a function read at every connect (a supervisor switching between addresses). */
    url: string | (() => string);
    protocol: string;
    /** How long a socket may take to open before the attempt fails, ms. Default 5000. */
    handshakeTimeout?: number;
    codec: ITransportCodec<Message>;
    getMessageName: (message: ISocketMessage) => string;
    logger: ILogger<Message>;
}

export const createSocketAdapter = <Message extends ISocketMessage>(params: ISocketAdapterParams<Message>): ITransportAdapter<Message, Message, Message> => {
    const {prefix, prefixColor, protocol, codec, getMessageName, logger} = params;

    const getUrl = typeof params.url === 'function' ? params.url : () => params.url as string;
    const openTimeout = params.handshakeTimeout ?? handshakeTimeout;

    // The address of the connection being opened or open; read once per connect.
    let url = getUrl();

    const messages: Record<string /* clientMsgId */, string /* clientMsgId */> = {};

    const state$ = new BehaviorSubject<TransportState>(TransportState.Disconnected);

    const data$ = new Subject<Message>();
    const event$ = new Subject<Message>();
    const message$ = new Subject<ArrayBuffer | string>();

    const socket = defer(() => race(
        createSocketConnector<ArrayBuffer | string>(url, protocol),
        timer(openTimeout).pipe(
            mergeMap(() => {
                return throwError(() => ({
                    errorCode: 'TimeoutReached',
                    description: 'Handshake timeout has been reached',
                }));
            }),
        ),
    )).pipe(
        switchMap(getResponses => {
            logger.info(`[${prefix}] connected to`, url);

            const request$ = getResponses(message$);

            state$.next(TransportState.Connected);

            return request$;
        }),
        catchError(error => {
            logger.info(`[${prefix}] socket error`, error ?? '');

            return [];
        }),
    );

    let subscription: Subscription | undefined;

    const connect = () => {
        // A second connect while one is open or opening would start a second connection and orphan the first.
        if (subscription && !subscription.closed) {
            return;
        }

        url = getUrl();

        state$.next(TransportState.Connecting);

        subscription = socket.subscribe({
            next: data => {
                try {
                    if (data) {
                        const message = codec.decode(data);

                        if (message) {
                            const messageName = getMessageName(message);

                            if (messages[message.clientMsgId]) {
                                logger.response(message, {prefix, prefixColor, messageName});
                                data$.next(message);
                            } else {
                                logger.event(message, {prefix, prefixColor, messageName});
                                event$.next(message);
                            }
                        } else {
                            logger.error(`[${prefix}] socket invalid decode`, data);
                        }
                    } else {
                        logger.error(`[${prefix}] socket invalid message`);
                    }
                } catch (error: unknown) {
                    logger.error(`[${prefix}] socket catch error`, error ?? '');
                }
            },
            error: (error: unknown) => {
                logger.error(`[${prefix}] socket error`, error ?? '');
            },
            complete: () => {
                logger.info(`[${prefix}] socket closed`, url);

                state$.next(TransportState.Disconnected);
            },
        });
    };

    const disconnect = () => {
        subscription?.unsubscribe();

        // Unsubscribing tears the connection down without completing it, so nothing else reports the drop:
        // without this state$ stays Connected and requests in flight never fail.
        if (state$.getValue() !== TransportState.Disconnected) {
            state$.next(TransportState.Disconnected);
        }
    };

    const add = (clientMsgId: string) => {
        messages[clientMsgId] = clientMsgId;
    };

    const drop = (clientMsgId: string) => {
        delete messages[clientMsgId];
    };

    const send = (message: Message) => {
        if (message) {
            if (state$.getValue() !== TransportState.Connected) {
                logger.info(`[${prefix}] socket is not connected, message was not sent`, message);

                // Nothing listens to message$ while the socket is down: throw rather than drop the message.
                throw {
                    errorCode: 'ClosedConnection',
                    description: `Message ${JSON.stringify(message)} was not sent. Connection is closed`,
                };
            }

            const messageName = getMessageName(message);

            logger.request(message, {prefix, prefixColor, messageName});

            const data = codec.encode(message);

            if (data) {
                message$.next(data);
            } else {
                logger.error(`[${prefix}] socket invalid encode`, data);
            }
        } else {
            logger.error(`[${prefix}] socket empty message`);
        }
    };

    return {
        data$: data$.asObservable().pipe(share()),
        event$: event$.asObservable().pipe(share()),
        // A BehaviorSubject already multicasts and replays the current state to a late subscriber.
        state$: state$.asObservable(),
        connect,
        disconnect,
        add,
        drop,
        send,
    };
};
