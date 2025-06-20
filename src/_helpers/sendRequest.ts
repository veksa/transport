import {Observable, race, throwError} from 'rxjs';
import {filter, mergeMap} from 'rxjs/operators';
import {IMessage, ITransportAdapter, ITransportAdapterMeta, TransportState} from '../interfaces';
import {v4} from "uuid";

export const sendRequest = <Response extends object>(
    adapter: ITransportAdapter,
    message: IMessage,
    meta?: ITransportAdapterMeta,
): Observable<IMessage> => {
    const clientMsgId = message.clientMsgId
        ? message.clientMsgId
        : v4();

    const request$ = new Observable<IMessage<Response>>(message$ => {
        if (!meta?.completed) {
            adapter.add(clientMsgId);
        }

        const subscription = adapter.data$.subscribe(data => {
            if (data.clientMsgId === clientMsgId) {
                message$.next({
                    payload: data.payload as Response,
                    payloadType: data.payloadType,
                    clientMsgId,
                });
            }
        });

        try {
            adapter.send({
                clientMsgId,
                payload: message.payload,
                payloadType: message.payloadType,
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
                description: `Message ${message.payloadType} was not sent. Connection is closed`,
            }));
        }),
    );

    return race(
        request$,
        disconnection$,
    );
};
