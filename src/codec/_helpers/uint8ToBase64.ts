import {uint8ToBase64Browser} from './uint8ToBase64Browser';

const hasNodeBuffer = typeof Buffer !== 'undefined' && typeof Buffer.from === 'function';

export const uint8ToBase64 = (bytes: Uint8Array): string => {
    if (hasNodeBuffer) {
        return Buffer.from(bytes).toString('base64');
    }

    return uint8ToBase64Browser(bytes);
};
