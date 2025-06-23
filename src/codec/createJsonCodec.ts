import {ITransportCodec, IMessage} from '../interfaces';

export const createJsonCodec = (): ITransportCodec => {
    const encode = (message: IMessage): ArrayBuffer | string => {
        return JSON.stringify(message);
    };

    const decode = (buffer: ArrayBuffer | string): IMessage => {
        return JSON.parse(buffer as string);
    };

    return {
        encode,
        decode,
    };
};
