import {BehaviorSubject, race, share, Subject, Subscription, switchMap, throwError, timer} from 'rxjs';
import {createSocketConnector} from './createSocketConnector';
import {catchError, mergeMap} from 'rxjs/operators';
import {ILogger} from '@veksa/logger';
import {IMessage, ITransportAdapter, ITransportCodec, TransportState} from '../interfaces';

export const handshakeTimeout = 5000;

interface ISocketAdapterParams {
    prefix: string;
    prefixColor?: string;
    url: string;
    protocol: string;
    codec: ITransportCodec;
    getPayloadName: (payloadType: number) => string;
    logger: ILogger;
}

export const createSocketAdapter = (params: ISocketAdapterParams): ITransportAdapter => {
    const {prefix, prefixColor, url, protocol, codec, getPayloadName, logger} = params;

    const messages: Record<string /* clientMsgId */, string /* clientMsgId */> = {};

    const state$ = new BehaviorSubject<TransportState>(TransportState.Disconnected);

    const data$ = new Subject<IMessage>();
    const event$ = new Subject<IMessage>();
    const message$ = new Subject<ArrayBuffer | string>();

    const timeout$ = timer(handshakeTimeout);

    const socket = race(
        createSocketConnector<ArrayBuffer | string>(url, protocol),
        timeout$.pipe(
            mergeMap(() => {
                return throwError(() => ({
                    errorCode: 'TimeoutReached',
                    description: 'Handshake timeout has been reached',
                }));
            }),
        ),
    ).pipe(
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

    let subscription: Subscription;

    const connect = () => {
        subscription = socket.subscribe({
            next: data => {
                try {
                    if (data) {
                        const message = codec.decode(data);

                        if (message) {
                            const messageName = getPayloadName(message.payloadType);

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
    };

    const add = (clientMsgId: string) => {
        messages[clientMsgId] = clientMsgId;
    };

    const drop = (clientMsgId: string) => {
        delete messages[clientMsgId];
    };

    const send = (message: IMessage) => {
        if (message) {
            const messageName = getPayloadName(message.payloadType);

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
        state$: state$.asObservable().pipe(share()),
        connect,
        disconnect,
        add,
        drop,
        send,
    };
};
