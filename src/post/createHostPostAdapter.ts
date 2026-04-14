import {createPostAdapter} from './createPostAdapter';
import {ITransportAdapter, ITransportCodec} from '../interfaces';
import {ILogger} from '@veksa/logger';
import {IPostMessage} from './post.interface';

interface IHostAdapterParams<Message extends IPostMessage> {
    frame?: HTMLIFrameElement;
    prefix: string;
    prefixColor?: string;
    codec: ITransportCodec<Message>;
    getMessageName: (message: IPostMessage) => string;
    logger: ILogger<Message>;
}

export const createHostPostAdapter = <Message extends IPostMessage>(
    params: IHostAdapterParams<Message>,
): ITransportAdapter<Message, Message, Message> => {
    const {frame, prefix, prefixColor, codec, getMessageName, logger} = params;

    return createPostAdapter({
        type: 'message-from-host',
        frame, prefix, prefixColor, codec, getMessageName,
        logger,
    });
};
