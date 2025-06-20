import {BehaviorSubject, Subject, switchMap, Subscription} from 'rxjs';
import {catchError, filter} from 'rxjs/operators';
import {createHostConnector} from './createHostConnector';
import {ILogger} from '@veksa/logger';
import {TransportState, IMessage, ITransportAdapter} from '../interfaces';

interface IHostAdapterParams {
    prefix: string;
    prefixColor?: string;
    getPayloadName: (payloadType: number) => string;
    logger: ILogger;
}

export const createHostAdapter = (params: IHostAdapterParams): ITransportAdapter => {
    const {prefix, prefixColor, getPayloadName, logger} = params;

    const messages: Record<string /* clientMsgId */, string /* clientMsgId */> = {};

    const state$ = new BehaviorSubject<TransportState>(TransportState.Disconnected);

    const data$ = new Subject<IMessage>();
    const message$ = new Subject<IMessage>();

    const host = createHostConnector<IMessage>().pipe(
        switchMap(getResponses => {
            logger.info(`[${prefix}] connected to host`);

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
                        } else {
                            logger.event(message, {prefix, prefixColor, messageName});
                        }

                        data$.next(message);
                    }
                } catch (error: unknown) {
                    logger.error(`[${prefix}] host catch error`, error ?? '');
                }
            },
            error: (error: unknown) => {
                logger.error(`[${prefix}] host error`, error ?? '');
            },
            complete: () => {
                logger.info(`[${prefix}] host closed`);

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
            message$.next(message);
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
