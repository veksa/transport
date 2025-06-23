import {Observable, Subject, Subscription} from 'rxjs';
import {MessageType} from "../interfaces";

export type GetWebSocketResponses<T = MessageType> = (
    input: Observable<T>,
) => Observable<T>;

export const socketCloseCode = 1000;

export function createSocketConnector<Data extends MessageType>(
    url: string, protocol: string,
): Observable<GetWebSocketResponses<Data>> {
    return new Observable<GetWebSocketResponses<Data>>(observer => {
        let inputSubscription: Subscription;
        const messages = new Subject<Data>();

        let isSocketClosed = false;
        let forcedClose = false;

        const setClosedStatus = (): void => {
            isSocketClosed = true;
        };

        const socket = new WebSocket(url, protocol);

        const getWebSocketResponses: GetWebSocketResponses<Data> = (
            input: Observable<Data>,
        ) => {
            inputSubscription = input.subscribe(data => {
                socket.send(data);
            });
            return messages;
        };

        socket.onopen = (): void => {
            if (forcedClose) {
                isSocketClosed = true;
                socket.close();
            } else {
                observer.next(getWebSocketResponses);
            }
        };

        socket.onmessage = (message: { data: Data }): void => {
            messages.next(message.data);
        };

        socket.onerror = (event: unknown): void => {
            setClosedStatus();

            observer.error({
                errorCode: 'SocketError',
                description: (event as { message?: string }).message,
            } as unknown);
        };

        socket.onclose = (event: { code: number; reason: string }): void => {
            // prevent observer.complete() being called after observer.error(...)
            if (isSocketClosed) {
                return;
            }

            setClosedStatus();

            if (forcedClose || event.code === socketCloseCode) {
                observer.complete();
                messages.complete();
            } else {
                observer.error({
                    errorCode: 'SocketError',
                    description: event.reason,
                } as unknown);
            }
        };

        return (): void => {
            forcedClose = true;

            inputSubscription?.unsubscribe();

            if (!isSocketClosed) {
                setClosedStatus();
                socket.close(socketCloseCode);
            }
        };
    });
}
