import {IMessage, ITransportCodec} from '../interfaces';
import {uint8ToBase64} from './_helpers/uint8ToBase64';
import {base64ToUint8} from './_helpers/base64ToUint8';

const getNestedValue = (obj: any, path: string): any => {
    return path.split('.').reduce((current, key) => current?.[key], obj);
};

const transformBinaryFields = (obj: any, binaryKeys: Set<string>, path: string[] = []): any => {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(item => transformBinaryFields(item, binaryKeys, path));
    }

    const result: any = {};
    for (const key of Object.keys(obj)) {
        const currentPath = [...path, key].join('.');
        const value = obj[key];

        if (binaryKeys.has(currentPath) && value instanceof Uint8Array) {
            result[key] = uint8ToBase64(value);
        } else if (typeof value === 'object' && value !== null) {
            result[key] = transformBinaryFields(value, binaryKeys, [...path, key]);
        } else {
            result[key] = value;
        }
    }
    return result;
};

const setNestedValue = (obj: any, path: string, value: any): void => {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    const target = keys.reduce((current, key) => {
        if (!(key in current)) {
            current[key] = {};
        }
        return current[key];
    }, obj);
    target[lastKey] = value;
};

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
        // The paths that lead to a binary key: only objects on them are copied, the rest is serialised as given.
        const prefixes = new Set(keys.flatMap(key => key.split('.').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('.'))));

        // Copies every object on the way to a binary key before writing into it: the caller's message keeps its Uint8Arrays.
        const processObject = (obj: any, path: string[] = []): any => {
            const out = {...obj};

            for (const key of Object.keys(out)) {
                const currentPath = [...path, key].join('.');
                const value = out[key];

                if (keysSet.has(currentPath) && value instanceof Uint8Array) {
                    out[key] = uint8ToBase64(value);
                } else if (prefixes.has(currentPath) && value && typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value)) {
                    out[key] = processObject(value, [...path, key]);
                }
            }

            return out;
        };

        const copy = processObject(message);
        return JSON.stringify(copy);
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

        for (const key of keys) {
            const value = getNestedValue(parsed, key);
            if (typeof value === 'string') {
                try {
                    setNestedValue(parsed, key, base64ToUint8(value));
                } catch {
                    // If base64 decoding fails, keep the original value
                }
            }
        }

        return parsed;
    };

    return {
        encode,
        decode,
    };
};
