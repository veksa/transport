import {ITransportCodec, IMessage} from '../interfaces';

export const createJsonCodec = (): ITransportCodec => {
    const encode = (message: IMessage) => {
        return JSON.stringify(message);
    };

    const decode = (buffer: string): IMessage => {
        return JSON.parse(buffer);
    };

    return {
        encode,
        decode,
    };
};
