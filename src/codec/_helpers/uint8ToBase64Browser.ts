import {encodeStringTable} from './base64Tables';

const PAD = '=';

export const uint8ToBase64Browser = (bytes: Uint8Array): string => {
    const len = bytes.length;
    const remainder = len % 3;
    const baseLen = len - remainder;
    const out: string[] = new Array(Math.ceil(len / 3) * 4);

    let i = 0;
    let j = 0;

    while (i < baseLen) {
        const b0 = bytes[i++];
        const b1 = bytes[i++];
        const b2 = bytes[i++];
        out[j++] = encodeStringTable[b0 >> 2];
        out[j++] = encodeStringTable[((b0 & 3) << 4) | (b1 >> 4)];
        out[j++] = encodeStringTable[((b1 & 15) << 2) | (b2 >> 6)];
        out[j++] = encodeStringTable[b2 & 63];
    }

    if (remainder === 1) {
        const b0 = bytes[i];
        out[j++] = encodeStringTable[b0 >> 2];
        out[j++] = encodeStringTable[(b0 & 3) << 4];
        out[j++] = PAD;
        out[j++] = PAD;
    } else if (remainder === 2) {
        const b0 = bytes[i++];
        const b1 = bytes[i];
        out[j++] = encodeStringTable[b0 >> 2];
        out[j++] = encodeStringTable[((b0 & 3) << 4) | (b1 >> 4)];
        out[j++] = encodeStringTable[(b1 & 15) << 2];
        out[j++] = PAD;
    }

    return out.join('');
};
