import {Observable, Subject, Subscription} from 'rxjs';
import {IMessage} from '../interfaces';

export type GetHostResponses<T = IMessage> = (
    input: Observable<T>,
) => Observable<T>;

export function createHostConnector<T extends IMessage = IMessage>(): Observable<GetHostResponses<T>> {
    return new Observable<GetHostResponses<T>>(observer => {
        let inputSubscription: Subscription;
        const messages = new Subject<T>();

        const getHostResponses: GetHostResponses<T> = (
            input: Observable<T>,
        ) => {
            inputSubscription = input.subscribe(data => {
                if (window !== window.parent) { // iframe
                    window.parent.postMessage({
                        type: 'message-to-host',
                        data,
                    }, '*');
                } else { // webview or native
                    window.dispatchEvent(new MessageEvent('message-to-host', {
                        data,
                    }));
                }
            });
            return messages;
        };

        observer.next(getHostResponses);

        if (window !== window.parent) { // iframe
            window.addEventListener('message', (message: any) => {
                if (message.type === 'message') {
                    if (message.data.type === 'message-from-host') {
                        messages.next(message.data.data);
                    }
                }
            });
        } else { // webview or native
            window.addEventListener('message-from-host', (message: any) => {
                messages.next(message.data);
            });
        }

        return (): void => {
            inputSubscription?.unsubscribe();
        };
    });
}
