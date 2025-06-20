import {Observable, race, throwError} from 'rxjs';
import {filter, mergeMap} from 'rxjs/operators';
import {ITransportAdapter, IMessage, TransportState} from '../interfaces';

export const sendRequest = <Response extends object>(
    adapter: ITransportAdapter,
    message: IMessage,
    clientMsgId: string,
): Observable<IMessage> => {
    const request$ = new Observable<IMessage<Response>>(subscriber => {
        adapter.add(clientMsgId);

        const subscription = adapter.data$.subscribe(data => {
            if (data.clientMsgId === clientMsgId) {
                subscriber.next({
                    payload: data.payload as Response,
                    payloadType: data.payloadType,
                    clientMsgId,
                });

                adapter.drop(clientMsgId);

                subscription.unsubscribe();
                subscriber.complete();
            }
        });

        try {
            adapter.send({
                clientMsgId,
                payload: message.payload,
                payloadType: message.payloadType,
            });
        } catch (error) {
            adapter.drop(clientMsgId);

            subscription.unsubscribe();
            subscriber.error(error);
        }

        return () => {
            adapter.drop(clientMsgId);

            subscription.unsubscribe();
            subscriber.complete();
        };
    });

    const disconnection$ = adapter.state$.pipe(
        filter(state => state === TransportState.Disconnected),
        mergeMap(() => {
            adapter.drop(clientMsgId);

            return throwError(() => ({
                errorCode: 'ClosedConnection',
                description: `Message ${message.payloadType} was not sent. Connection is closed`,
            }));
        }),
    );

    return race(
        request$,
        disconnection$,
    );
};
