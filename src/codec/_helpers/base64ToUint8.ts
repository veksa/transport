import {base64ToUint8Browser} from './base64ToUint8Browser';

const hasNodeBuffer = typeof Buffer !== 'undefined' && typeof Buffer.from === 'function';

export const base64ToUint8 = (base64: string): Uint8Array => {
    if (hasNodeBuffer) {
        const buf = Buffer.from(base64, 'base64');
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }

    return base64ToUint8Browser(base64);
};
