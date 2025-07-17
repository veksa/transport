import {createPostAdapter} from './createPostAdapter';
import {ITransportAdapter} from '../interfaces';
import {ILogger} from '@veksa/logger';
import {IPostMessage} from './post.interface';

interface IHostAdapterParams<Message extends IPostMessage> {
    frame?: HTMLIFrameElement;
    prefix: string;
    prefixColor?: string;
    getMessageName: (payloadType: number) => string;
    logger: ILogger<Message>;
}

export const createHostPostAdapter = <Message extends IPostMessage>(
    params: IHostAdapterParams<Message>,
): ITransportAdapter<Message, Message, Message> => {
    const {frame, prefix, prefixColor, getMessageName, logger} = params;

    return createPostAdapter({
        type: 'message-from-host',
        frame, prefix, prefixColor, getMessageName,
        logger,
    });
};
