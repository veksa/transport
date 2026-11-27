import {Observable, race, throwError} from 'rxjs';
import {filter, mergeMap} from 'rxjs/operators';
import {IMessage, ITransportAdapter, ITransportAdapterMeta, TransportErrorCode, TransportState} from '../interfaces';
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
        filter(state => state !== TransportState.Connected),
        mergeMap(() => {
            adapter.drop(clientMsgId);

            return throwError(() => ({
                errorCode: TransportErrorCode.ClosedConnection,
                description: `Message ${JSON.stringify(message)} was not sent. Connection is closed`,
            }));
        }),
    );

    // disconnection$ goes first: state$ replays the current state, so a request made while the transport
    // is not connected fails at once with ClosedConnection and is never handed to the adapter.
    return race(
        disconnection$,
        request$,
    );
};
