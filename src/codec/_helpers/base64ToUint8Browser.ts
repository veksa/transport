import {decodeTable} from './base64Tables';

export const base64ToUint8Browser = (base64: string): Uint8Array => {
    const len = base64.length;
    const padding = base64[len - 1] === '=' ? (base64[len - 2] === '=' ? 2 : 1) : 0;
    const outputLen = (len * 3) / 4 - padding;
    const out = new Uint8Array(outputLen);

    let i = 0;
    let j = 0;
    const limit = len - (padding > 0 ? 4 : 0);

    while (i < limit) {
        const v0 = decodeTable[base64.charCodeAt(i++)];
        const v1 = decodeTable[base64.charCodeAt(i++)];
        const v2 = decodeTable[base64.charCodeAt(i++)];
        const v3 = decodeTable[base64.charCodeAt(i++)];
        out[j++] = (v0 << 2) | (v1 >> 4);
        out[j++] = ((v1 & 15) << 4) | (v2 >> 2);
        out[j++] = ((v2 & 3) << 6) | v3;
    }

    if (padding === 1) {
        const v0 = decodeTable[base64.charCodeAt(i++)];
        const v1 = decodeTable[base64.charCodeAt(i++)];
        const v2 = decodeTable[base64.charCodeAt(i++)];
        out[j++] = (v0 << 2) | (v1 >> 4);
        out[j++] = ((v1 & 15) << 4) | (v2 >> 2);
    } else if (padding === 2) {
        const v0 = decodeTable[base64.charCodeAt(i++)];
        const v1 = decodeTable[base64.charCodeAt(i++)];
        out[j++] = (v0 << 2) | (v1 >> 4);
    }

    return out;
};
