import {Observable, race, throwError} from 'rxjs';
import {filter, mergeMap} from 'rxjs/operators';
import {ITransportAdapter, ITransportAdapterMeta, TransportState, IMessage} from '../interfaces';
import {v4} from 'uuid';

export const sendRequest = <Message extends IMessage>(
    adapter: ITransportAdapter<Message, Message, Message>,
    message: Message,
    meta?: ITransportAdapterMeta,
): Observable<Message> => {
    const clientMsgId = message.clientMsgId
        ? message.clientMsgId
        : v4();

    const request$ = new Observable<Message>(message$ => {
        if (!meta?.completed) {
            adapter.add(clientMsgId);
        }

        const subscription = adapter.data$.subscribe(data => {
            if (data.clientMsgId === clientMsgId) {
                message$.next({
                    ...data,
                    clientMsgId,
                });
            }
        });

        try {
            adapter.send({
                ...message,
                clientMsgId,
            });

            if (meta?.completed) {
                adapter.drop(clientMsgId);

                subscription.unsubscribe();
                message$.complete();
            }
        } catch (error) {
            adapter.drop(clientMsgId);

            subscription.unsubscribe();
            message$.error(error);
        }

        return () => {
            adapter.drop(clientMsgId);

            subscription.unsubscribe();
            message$.complete();
        };
    });

    const disconnection$ = adapter.state$.pipe(
        filter(state => state === TransportState.Disconnected),
        mergeMap(() => {
            adapter.drop(clientMsgId);

            return throwError(() => ({
                errorCode: 'ClosedConnection',
                description: `Message ${JSON.stringify(message)} was not sent. Connection is closed`,
            }));
        }),
    );

    return race(
        request$,
        disconnection$,
    );
};
