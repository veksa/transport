import {firstValueFrom, throwError, timeout} from 'rxjs';
import {sendRequest} from './_helpers/sendRequest';
import {IMessage, ISendOptions, ITransport, ITransportAdapter, ITransportApi, TransportErrorCode} from './interfaces';
import {ILogger} from '@veksa/logger';

/** How long a request waits for its reply by default when the transport is built from an options object, ms. */
export const defaultRequestTimeout = 20_000;

export interface ITransportParams<Type extends string, Message extends IMessage> {
    type: Type;
    adapter: ITransportAdapter<Message, Message, Message>;
    logger: ILogger<Message>;
    /** Tells an error reply apart; `send` rejects with its payload. */
    isError?: (message: Message) => boolean;
    /**
     * How long a request waits for its reply before it fails with `RequestTimeout`, ms. Default
     * `defaultRequestTimeout`; `0` waits for ever. A request on a socket that stays open but never answers would
     * otherwise hold its caller for good.
     */
    requestTimeout?: number;
}

type ICreateTransport = {
    <Type extends string, Message extends IMessage>(params: ITransportParams<Type, Message>): ITransport<Type, Message, Message, Message>;
    /** @deprecated Pass an options object: `createTransport({type, adapter, logger, isError})`. No request timeout. */
    <Type extends string, Message extends IMessage>(
        type: Type,
        adapter: ITransportAdapter<Message, Message, Message>,
        logger: ILogger<Message>,
        isError?: (message: Message) => boolean,
    ): ITransport<Type, Message, Message, Message>;
};

export const createTransport: ICreateTransport = <Type extends string, Message extends IMessage>(
    typeOrParams: Type | ITransportParams<Type, Message>,
    positionalAdapter?: ITransportAdapter<Message, Message, Message>,
    positionalLogger?: ILogger<Message>,
    positionalIsError?: (message: Message) => boolean,
): ITransport<Type, Message, Message, Message> => {
    const params: ITransportParams<Type, Message> = typeof typeOrParams === 'object'
        ? {requestTimeout: defaultRequestTimeout, ...typeOrParams}
        : {
            type: typeOrParams,
            adapter: positionalAdapter!,
            logger: positionalLogger!,
            isError: positionalIsError,
            requestTimeout: 0,
        };

    const {type, adapter, logger, isError, requestTimeout} = params;

    const connect = () => {
        adapter.connect();
    };

    const disconnect = () => {
        adapter.disconnect();
    };

    const send = async (message: Message, options?: ISendOptions) => {
        const wait = options?.timeout ?? requestTimeout ?? 0;

        const request$ = sendRequest<Message>(adapter, message);

        const response$ = wait > 0
            ? request$.pipe(timeout({
                first: wait,
                // Unsubscribing the request on the way out forgets its clientMsgId: a late reply is an event, not a reply.
                with: () => throwError(() => ({
                    errorCode: TransportErrorCode.RequestTimeout,
                    description: `Message ${JSON.stringify(message)} got no reply in ${wait} ms`,
                })),
            }))
            : request$;

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
