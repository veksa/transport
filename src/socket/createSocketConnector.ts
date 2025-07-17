import {Observable, Subject, Subscription} from 'rxjs';
import {MessagePayload} from './socket.interface';

export const socketCloseCode = 1000;

export type GetSocketResponses<T = MessagePayload> = (input: Observable<T>) => Observable<T>;

export function createSocketConnector<Payload extends MessagePayload>(
    url: string, protocol: string,
): Observable<GetSocketResponses<Payload>> {
    return new Observable<GetSocketResponses<Payload>>(observer => {
        let inputSubscription: Subscription;
        const messages = new Subject<Payload>();

        let isSocketClosed = false;
        let forcedClose = false;

        const setClosedStatus = (): void => {
            isSocketClosed = true;
        };

        const socket = new WebSocket(url, protocol);

        const getWebSocketResponses: GetSocketResponses<Payload> = (
            input: Observable<Payload>,
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

        socket.onmessage = (message: {data: Payload}): void => {
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
