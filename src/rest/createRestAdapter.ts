import {BehaviorSubject, race, share, Subject, Subscription, switchMap, throwError, timer} from 'rxjs';
import {catchError, mergeMap} from 'rxjs/operators';
import {ILogger} from '@veksa/logger';
import {createRestConnector} from './createRestConnector';
import {ITransportAdapter, TransportState} from '../interfaces';
import {IRestMessage} from './rest.interface';

export const handshakeTimeout = 5000;

interface IRestAdapterParams<Message extends IRestMessage> {
    prefix: string;
    prefixColor?: string;
    url: string;
    health?: string;
    getMessageName: (message: IRestMessage) => string;
    logger: ILogger<Message>;
}

export const createRestAdapter = <Message extends IRestMessage>(
    params: IRestAdapterParams<Message>,
): ITransportAdapter<Message, Message, Message> => {
    const {prefix, prefixColor, url, health, getMessageName, logger} = params;

    const messages: Record<string /* clientMsgId */, string /* clientMsgId */> = {};

    const state$ = new BehaviorSubject<TransportState>(TransportState.Disconnected);

    const data$ = new Subject<Message>();
    const message$ = new Subject<Message>();

    const timeout$ = timer(handshakeTimeout);

    const connector = race(
        createRestConnector<Message>(url, health),
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
            logger.info(`[${prefix}] rest error`, error ?? '');

            return [];
        }),
    );

    let subscription: Subscription;

    const connect = () => {
        subscription = connector.subscribe({
            next: message => {
                try {
                    if (message) {
                        const messageName = getMessageName(message);

                        logger.response(message, {prefix, prefixColor, messageName});
                        data$.next(message);
                    } else {
                        logger.error(`[${prefix}] rest invalid message`);
                    }
                } catch (error: unknown) {
                    logger.error(`[${prefix}] rest catch error`, error ?? '');
                }
            },
            error: (error: unknown) => {
                logger.error(`[${prefix}] rest error`, error ?? '');
            },
            complete: () => {
                logger.info(`[${prefix}] rest closed`, url);

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
        if (message) {
            const messageName = getMessageName(message);

            logger.request(message, {prefix, prefixColor, messageName});

            message$.next(message);
        } else {
            logger.error(`[${prefix}] rest empty message`);
        }
    };

    return {
        data$: data$.asObservable().pipe(share()),
        state$: state$.asObservable().pipe(share()),
        connect,
        disconnect,
        add,
        drop,
        send,
    };
};
