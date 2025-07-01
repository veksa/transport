import {BehaviorSubject, share, Subject, Subscription, switchMap} from 'rxjs';
import {catchError} from 'rxjs/operators';
import {createMessageConnector} from './createMessageConnector';
import {ILogger} from '@veksa/logger';
import {IMessage, ITransportAdapter, TransportState} from '../interfaces';

interface IMessageAdapterParams {
    type: 'message-to-host' | 'message-from-host';
    frame?: HTMLIFrameElement;
    prefix: string;
    prefixColor?: string;
    getPayloadName: (payloadType: number) => string;
    logger: ILogger;
}

export const createMessageAdapter = (params: IMessageAdapterParams): ITransportAdapter => {
    const {type, frame, prefix, prefixColor, getPayloadName, logger} = params;

    const messages: Record<string /* clientMsgId */, string /* clientMsgId */> = {};

    const state$ = new BehaviorSubject<TransportState>(TransportState.Disconnected);

    const data$ = new Subject<IMessage>();
    const event$ = new Subject<IMessage>();
    const message$ = new Subject<IMessage>();

    const host = createMessageConnector<IMessage>(type, frame).pipe(
        switchMap(getResponses => {
            if (type === 'message-to-host') {
                logger.info(`[${prefix}] connected to host`);
            } else {
                logger.info(`[${prefix}] connected to client`);
            }

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
        subscription = host.subscribe({
            next: message => {
                try {
                    if (message !== undefined) {
                        const messageName = getPayloadName(message.payloadType);

                        if (messages[message.clientMsgId]) {
                            logger.response(message, {prefix, prefixColor, messageName});
                            data$.next(message);
                        } else {
                            logger.event(message, {prefix, prefixColor, messageName});
                            event$.next(message);
                        }
                    }
                } catch (error: unknown) {
                    logger.error(`[${prefix}] catch error`, error ?? '');
                }
            },
            error: (error: unknown) => {
                logger.error(`[${prefix}] error`, error ?? '');
            },
            complete: () => {
                logger.info(`[${prefix}] closed`);

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

        if (messages[message.clientMsgId]) {
            logger.request(message, {prefix, prefixColor, messageName});
        } else {
            logger.event(message, {prefix, prefixColor, messageName});
        }

        message$.next(message);
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
