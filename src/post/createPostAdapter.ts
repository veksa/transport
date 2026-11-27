import {BehaviorSubject, share, Subject, Subscription, switchMap} from 'rxjs';
import {catchError} from 'rxjs/operators';
import {createPostConnector} from './createPostConnector';
import {ILogger} from '@veksa/logger';
import {ITransportAdapter, TransportState} from '../interfaces';
import {IPostMessage} from './post.interface';

interface IMessageAdapterParams<Message extends IPostMessage> {
    type: 'message-to-host' | 'message-from-host';
    frame?: HTMLIFrameElement;
    prefix: string;
    prefixColor?: string;
    getMessageName: (message: IPostMessage) => string;
    logger: ILogger<Message>;
}

export const createPostAdapter = <Message extends IPostMessage>(
    params: IMessageAdapterParams<Message>,
): ITransportAdapter<Message, Message, Message> => {
    const {type, frame, prefix, prefixColor, getMessageName, logger} = params;

    const messages: Record<string /* clientMsgId */, string /* clientMsgId */> = {};

    const state$ = new BehaviorSubject<TransportState>(TransportState.Disconnected);

    const data$ = new Subject<Message>();
    const event$ = new Subject<Message>();
    const message$ = new Subject<Message>();

    const host = createPostConnector<Message>(type, frame).pipe(
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

    let subscription: Subscription | undefined;

    const connect = () => {
        // A second connect while one is open or opening would start a second connection and orphan the first.
        if (subscription && !subscription.closed) {
            return;
        }

        subscription = host.subscribe({
            next: message => {
                try {
                    if (message !== undefined) {
                        const messageName = getMessageName(message);

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
        const messageName = getMessageName(message);

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
        // A BehaviorSubject already multicasts and replays the current state to a late subscriber.
        state$: state$.asObservable(),
        connect,
        disconnect,
        add,
        drop,
        send,
    };
};
