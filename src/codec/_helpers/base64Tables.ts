const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export const encodeTable = new Uint8Array(64);
for (let i = 0; i < 64; i++) {
    encodeTable[i] = BASE64_CHARS.charCodeAt(i);
}

export const encodeStringTable: string[] = [];
for (let i = 0; i < 64; i++) {
    encodeStringTable[i] = BASE64_CHARS[i];
}

export const decodeTable = new Uint8Array(256).fill(255);
for (let i = 0; i < 64; i++) {
    decodeTable[encodeTable[i]] = i;
}
