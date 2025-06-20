import {Observable, Subject, Subscription} from 'rxjs';
import {IMessage} from '../interfaces';

export type GetHostResponses<T = IMessage> = (
    input: Observable<T>,
) => Observable<T>;

export function createMessageConnector<T extends IMessage = IMessage>(
    type: 'message-to-host' | 'message-from-host',
    frame?: HTMLIFrameElement,
): Observable<GetHostResponses<T>> {
    const directType = type;
    const oppositeType = type === 'message-to-host'
        ? 'message-from-host'
        : 'message-to-host';

    return new Observable<GetHostResponses<T>>(observer => {
        let subscription: Subscription;
        const messages = new Subject<T>();

        const getHostResponses: GetHostResponses<T> = (input: Observable<T>) => {
            subscription = input.subscribe(data => {
                if (window !== window.parent) { // iframe
                    if (directType === 'message-to-host') {
                        window.parent.postMessage({
                            type: directType,
                            data,
                        }, '*');
                    }
                } else if (frame) {
                    frame.contentWindow?.postMessage({
                        type: directType,
                        data,
                    }, '*');
                } else { // webview or native
                    window.dispatchEvent(new MessageEvent(directType, {
                        data,
                    }));
                }
            });

            return messages;
        };

        observer.next(getHostResponses);

        const messageHandler = (message: any) => {
            if (message.type === 'message') {
                if (message.data.type === oppositeType) {
                    messages.next(message.data.data);
                }
            }
        };

        const hostMessageHandler = (message: any) => {
            messages.next(message.data);
        };

        window.addEventListener('message', messageHandler);
        window.addEventListener(oppositeType, hostMessageHandler);

        return (): void => {
            subscription?.unsubscribe();

            window.removeEventListener('message', messageHandler);
            window.removeEventListener(oppositeType, hostMessageHandler);
        };
    });
}
