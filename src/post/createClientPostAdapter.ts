import {ITransportAdapter} from '../interfaces';
import {createPostAdapter} from './createPostAdapter';
import {ILogger} from '@veksa/logger';
import {IPostMessage} from './post.interface';

interface IClientAdapterParams<Message extends IPostMessage> {
    prefix: string;
    prefixColor?: string;
    getMessageName: (payloadType: number) => string;
    logger: ILogger<Message>;
}

export const createClientPostAdapter = <Message extends IPostMessage>(
    params: IClientAdapterParams<Message>,
): ITransportAdapter<Message, Message, Message> => {
    const {prefix, prefixColor, getMessageName, logger} = params;

    return createPostAdapter({
        type: 'message-to-host',
        prefix, prefixColor, getMessageName,
        logger,
    });
};
