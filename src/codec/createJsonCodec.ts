import {ITransportCodec, IMessage} from '../interfaces';

export const createJsonCodec = <Message extends IMessage>(): ITransportCodec<Message> => {
    const encode = (message: Message): ArrayBuffer | string => {
        return JSON.stringify(message);
    };

    const decode = (buffer: ArrayBuffer | string): Message => {
        return JSON.parse(buffer as string);
    };

    return {
        encode,
        decode,
    };
};
