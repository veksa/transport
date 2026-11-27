interface IWebCrypto {
    randomUUID?: () => string;
    getRandomValues?: <T extends Uint8Array>(array: T) => T;
}

const hex = (bytes: ArrayLike<number>): string => {
    let out = '';

    for (let i = 0; i < bytes.length; i++) {
        out += (bytes[i] + 0x100).toString(16).slice(1);
    }

    return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
};

const randomBytes = (webCrypto: IWebCrypto | undefined): Uint8Array => {
    const bytes = new Uint8Array(16);

    if (typeof webCrypto?.getRandomValues === 'function') {
        return webCrypto.getRandomValues(bytes);
    }

    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 0x100);
    }

    return bytes;
};

/**
 * Makes the `clientMsgId` that pairs a request with its responses: an RFC 4122 version 4 UUID.
 *
 * It is a correlation tag, not a secret, so it must work on every runtime the transport runs on. The global
 * Web Crypto object is read through `globalThis` and only when present: some JavaScript engines (Hermes, used by
 * React Native, among them) have no `crypto` global at all, and a bare `crypto` reference there throws a
 * ReferenceError on the first request. Without Web Crypto the bytes come from `Math.random`, which is enough for
 * an id that only has to be unique among the requests in flight.
 */
export const createMessageId = (): string => {
    const webCrypto = (globalThis as {crypto?: IWebCrypto}).crypto;

    if (typeof webCrypto?.randomUUID === 'function') {
        return webCrypto.randomUUID();
    }

    const bytes = randomBytes(webCrypto);

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    return hex(bytes);
};
