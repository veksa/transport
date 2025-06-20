import {firstValueFrom} from 'rxjs';
import {sendRequest} from './_helpers/sendRequest';
import {IMessage, ITransport, ITransportAdapter, ITransportApi} from './interfaces';
import {ILogger} from '@veksa/logger';

export const createTransport = <Type extends string>(
    type: Type,
    adapter: ITransportAdapter,
    logger: ILogger,
    errorPayloads?: number[],
): ITransport<Type> => {
    const connect = () => {
        adapter.connect();
    };

    const disconnect = () => {
        adapter.disconnect();
    };

    const send = async (message: IMessage) => {
        const response$ = sendRequest<Response>(adapter, message);

        const response = await firstValueFrom(response$);

        if (errorPayloads?.includes(response.payloadType)) {
            throw response;
        }

        return response.payload as Response;
    };

    const api: ITransportApi<Type> = {
        type,
        event$: adapter.event$,
        send,
    };

    const getLogs = () => {
        return logger.getLogs();
    }

    return {
        state$: adapter.state$,
        connect,
        disconnect,
        api,
        getLogs,
    };
};
