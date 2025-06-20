import {BehaviorSubject, race, Subject, Subscription, switchMap, throwError, timer} from 'rxjs';
import {createSocketConnector} from './createSocketConnector';
import {catchError, mergeMap, filter} from 'rxjs/operators';
import {ILogger} from '@veksa/logger';
import {TransportState, ITransportCodec, IMessage, ITransportAdapter} from '../interfaces';

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
    const message$ = new Subject<string>();

    const timeout$ = timer(handshakeTimeout);

    const socket = race(
        createSocketConnector<string>(url, protocol),
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
                    if (data !== undefined) {
                        const message = codec.decode(data);

                        const messageName = getPayloadName(message.payloadType);

                        if (messages[message.clientMsgId]) {
                            logger.response(message, {prefix, prefixColor, messageName});
                        } else {
                            logger.event(message, {prefix, prefixColor, messageName});
                        }

                        data$.next(message);
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
        const messageName = getPayloadName(message.payloadType);

        logger.request(message, {prefix, prefixColor, messageName});

        if (message) {
            message$.next(codec.encode(message));
        }
    };

    return {
        data$: data$.asObservable(),
        event$: data$.pipe(
            filter(message => {
                return !Object.keys(messages).includes(message.clientMsgId);
            }),
        ),
        state$: state$.asObservable(),
        connect,
        disconnect,
        add,
        drop,
        send,
    };
};
