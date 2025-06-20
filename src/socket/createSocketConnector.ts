import {Observable, Subject, Subscription} from 'rxjs';

export type GetWebSocketResponses<T = string> = (
    input: Observable<T>,
) => Observable<T>;

export const socketCloseCode = 1000;

export function createSocketConnector<T extends string = string>(url: string, protocol: string): Observable<GetWebSocketResponses<T>> {
    return new Observable<GetWebSocketResponses<T>>(observer => {
        let inputSubscription: Subscription;
        const messages = new Subject<T>();

        let isSocketClosed = false;
        let forcedClose = false;

        const setClosedStatus = (): void => {
            isSocketClosed = true;
        };

        const socket = new WebSocket(url, protocol);

        const getWebSocketResponses: GetWebSocketResponses<T> = (
            input: Observable<T>,
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

        socket.onmessage = (message: {data: T}): void => {
            messages.next(message.data);
        };

        socket.onerror = (event: unknown): void => {
            setClosedStatus();

            observer.error({
                errorCode: 'SocketError',
                description: (event as {message?: string}).message,
            } as unknown);
        };

        socket.onclose = (event: {code: number; reason: string}): void => {
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
