import {IMessage, ITransportCodec} from '../interfaces';
import {uint8ToBase64} from './_helpers/uint8ToBase64';
import {patchBinaryFields} from './_helpers/patchBinaryFields';

export const createJsonCodec = <Message extends IMessage>(getBinaryKeys?: (message: Message) => string[]): ITransportCodec<Message> => {
    const encode = (message: Message): ArrayBuffer | string => {
        if (!getBinaryKeys) {
            return JSON.stringify(message);
        }

        const keys = getBinaryKeys(message);

        if (keys.length === 0) {
            return JSON.stringify(message);
        }

        const keysSet = new Set(keys);
        return JSON.stringify(message, (key, value) => {
            if (keysSet.has(key) && value instanceof Uint8Array) {
                return uint8ToBase64(value);
            }
            return value;
        });
    };

    const decode = (buffer: ArrayBuffer | string): Message => {
        const parsed = JSON.parse(buffer as string) as Message;

        if (!getBinaryKeys) {
            return parsed;
        }

        const keys = getBinaryKeys(parsed);

        if (keys.length === 0) {
            return parsed;
        }

        patchBinaryFields(parsed as unknown as Record<string, unknown>, new Set(keys));

        return parsed;
    };

    return {
        encode,
        decode,
    };
};
