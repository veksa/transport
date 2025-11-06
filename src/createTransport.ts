import {firstValueFrom} from 'rxjs';
import {sendRequest} from './_helpers/sendRequest';
import {ITransport, ITransportAdapter, ITransportApi, IMessage} from './interfaces';
import {ILogger} from '@veksa/logger';

export const createTransport = <Type extends string, Message extends IMessage>(
    type: Type,
    adapter: ITransportAdapter<Message, Message, Message>,
    logger: ILogger<Message>,
    isError?: (message: Message) => boolean,
): ITransport<Type, Message, Message, Message> => {
    const connect = () => {
        adapter.connect();
    };

    const disconnect = () => {
        adapter.disconnect();
    };

    const send = async (message: Message) => {
        const response$ = sendRequest<Message>(adapter, message);

        const response = await firstValueFrom(response$);

        if (isError?.(response)) {
            throw response.payload;
        }

        return response.payload as Response;
    };

    const api: ITransportApi<Type, Message, Message, Message> = {
        type,
        event$: adapter.event$,
        send,
    };

    const getLogs = () => {
        return logger.getLogs();
    };

    return {
        state$: adapter.state$,
        connect,
        disconnect,
        api,
        getLogs,
    };
};
