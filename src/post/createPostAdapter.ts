import {BehaviorSubject, share, Subject, Subscription, switchMap} from 'rxjs';
import {catchError} from 'rxjs/operators';
import {createPostConnector} from './createPostConnector';
import {ILogger} from '@veksa/logger';
import {ITransportAdapter, ITransportCodec, TransportState} from '../interfaces';
import {IPostMessage} from './post.interface';

interface IMessageAdapterParams<Message extends IPostMessage> {
    type: 'message-to-host' | 'message-from-host';
    frame?: HTMLIFrameElement;
    prefix: string;
    prefixColor?: string;
    codec: ITransportCodec<Message>;
    getMessageName: (message: IPostMessage) => string;
    logger: ILogger<Message>;
}

export const createPostAdapter = <Message extends IPostMessage>(
    params: IMessageAdapterParams<Message>,
): ITransportAdapter<Message, Message, Message> => {
    const {type, frame, prefix, prefixColor, codec, getMessageName, logger} = params;

    const messages: Record<string /* clientMsgId */, string /* clientMsgId */> = {};

    const state$ = new BehaviorSubject<TransportState>(TransportState.Disconnected);

    const data$ = new Subject<Message>();
    const event$ = new Subject<Message>();
    const message$ = new Subject<string | ArrayBuffer>();

    const host = createPostConnector(type, frame).pipe(
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
            logger.info(`[${prefix}] post error`, error ?? '');

            return [];
        }),
    );

    let subscription: Subscription;

    const connect = () => {
        subscription = host.subscribe({
            next: data => {
                try {
                    if (data !== undefined) {
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
                            logger.error(`[${prefix}] invalid decode`, data);
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

    const send = (message: Message) => {
        const messageName = getMessageName(message);

        if (messages[message.clientMsgId]) {
            logger.request(message, {prefix, prefixColor, messageName});
        } else {
            logger.event(message, {prefix, prefixColor, messageName});
        }

        const data = codec.encode(message);

        if (data) {
            message$.next(data);
        } else {
            logger.error(`[${prefix}] invalid encode`, data);
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
