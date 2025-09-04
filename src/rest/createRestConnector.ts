import {Observable, Subject, Subscription} from 'rxjs';
import {IRestMessage} from './rest.interface';

export type GetRestResponses<Message = IRestMessage> = (input: Observable<Message>) => Observable<Message>;

export function createRestConnector<Message extends IRestMessage>(
    url: string, health?: string,
): Observable<GetRestResponses<Message>> {
    return new Observable<GetRestResponses<Message>>(observer => {
        let inputSubscription: Subscription;
        const messages = new Subject<Message>();

        let isConnectionClosed = false;

        const healthUrl = health
            ? `${url}${health}`
            : undefined;

        const setClosedStatus = (): void => {
            isConnectionClosed = true;
        };

        const getRestResponses: GetRestResponses<Message> = (
            input: Observable<Message>,
        ) => {
            inputSubscription = input.subscribe(data => {
                if (!isConnectionClosed) {
                    fetch(`${url}${data.url}`, {
                        method: data.method,
                        headers: {
                            'Content-Type': 'application/json',
                            ...data.headers,
                        },
                        body: data.method !== 'get' && data.method !== 'head'
                            ? JSON.stringify(data.payload)
                            : undefined,
                    }).then(response => {
                        if (!response.ok) {
                            observer.error({
                                errorCode: 0,
                                description: `HTTP error. Status: ${response.status}`,
                            });
                            return;
                        }

                        return response.json();
                    }).then(responseData => {
                        if (!isConnectionClosed) {
                            messages.next({
                                url: data.url,
                                method: data.method,
                                headers: data.headers,
                                payload: responseData,
                                clientMsgId: data.clientMsgId,
                            } as Message);
                        }
                    }).catch(error => {
                        if (!isConnectionClosed) {
                            observer.error({
                                errorCode: error.status,
                                description: error.message,
                            });
                        }
                    });
                }
            });

            return messages;
        };

        if (healthUrl) {
            fetch(healthUrl).then(response => {
                if (!response.ok) {
                    throw new Error(`${healthUrl} not accessible: ${response.status} ${response.statusText}`);
                }

                return response.json();
            }).then(() => {
                observer.next(getRestResponses);
            }).catch(error => {
                isConnectionClosed = true;

                observer.error({
                    errorCode: 0,
                    description: error.message,
                });
            });
        } else {
            observer.next(getRestResponses);
        }

        return (): void => {
            inputSubscription?.unsubscribe();
            setClosedStatus();
            messages.complete();
        };
    });
}
