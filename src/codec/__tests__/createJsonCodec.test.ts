import {createJsonCodec} from '../createJsonCodec';

describe('createJsonCodec', () => {
    describe('without binaryKeys (default behaviour)', () => {
        const codec = createJsonCodec();

        it('encodes a plain message to JSON string', () => {
            const message = {payloadType: 1, clientMsgId: 'abc', payload: {foo: 'bar'}};
            expect(codec.encode(message)).toBe(JSON.stringify(message));
        });

        it('decodes a JSON string back to message', () => {
            const message = {payloadType: 1, clientMsgId: 'abc', payload: {foo: 'bar'}};
            expect(codec.decode(JSON.stringify(message))).toEqual(message);
        });

        it('does NOT convert Uint8Array to base64 — serialises as object', () => {
            const chunk = new Uint8Array([1, 2, 3]);
            const message = {payloadType: 1, clientMsgId: 'abc', payload: {chunk}};
            const parsed = JSON.parse(codec.encode(message) as string);
            expect(parsed.payload.chunk).toEqual({'0': 1, '1': 2, '2': 3});
        });
    });

    describe('with binaryKeys', () => {
        const codec = createJsonCodec(() => ['payload.chunk']);
        const makeChunk = (values: number[]) => new Uint8Array(values);

        it('encodes Uint8Array field as base64 string', () => {
            const chunk = makeChunk([72, 101, 108, 108, 111]);
            const message = {payloadType: 1, clientMsgId: 'abc', payload: {chunk}};
            const parsed = JSON.parse(codec.encode(message) as string);
            expect(typeof parsed.payload.chunk).toBe('string');
            expect(parsed.payload.chunk).toBe(btoa('Hello'));
        });

        it('decodes base64 string back to Uint8Array for binaryKeys field', () => {
            const chunk = makeChunk([72, 101, 108, 108, 111]);
            const message = {payloadType: 1, clientMsgId: 'abc', payload: {chunk}};
            const decoded = codec.decode(codec.encode(message) as string) as typeof message;
            expect(decoded.payload.chunk).toBeInstanceOf(Uint8Array);
            expect(Array.from(decoded.payload.chunk)).toEqual([72, 101, 108, 108, 111]);
        });

        it('round-trips correctly for large chunk (> 8192 bytes)', () => {
            const size = 20000;
            const original = new Uint8Array(size);
            for (let i = 0; i < size; i++) original[i] = i % 256;
            const message = {payloadType: 1, clientMsgId: 'abc', payload: {chunk: original}};
            const decoded = codec.decode(codec.encode(message) as string) as typeof message;
            expect(decoded.payload.chunk).toBeInstanceOf(Uint8Array);
            expect(decoded.payload.chunk.length).toBe(size);
            expect(Array.from(decoded.payload.chunk)).toEqual(Array.from(original));
        });

        it('does not affect non-binary fields', () => {
            const message = {payloadType: 42, clientMsgId: 'xyz', payload: {foo: 'bar', num: 123}};
            const decoded = codec.decode(codec.encode(message) as string) as typeof message;
            expect(decoded.payload.foo).toBe('bar');
            expect(decoded.payload.num).toBe(123);
            expect(decoded.payloadType).toBe(42);
            expect(decoded.clientMsgId).toBe('xyz');
        });

        it('does not convert string fields with non-binaryKey names', () => {
            const message = {payloadType: 1, clientMsgId: 'abc', payload: {uploadId: btoa('someBase64')}};
            const decoded = codec.decode(codec.encode(message) as string) as typeof message;
            expect(typeof decoded.payload.uploadId).toBe('string');
            expect(decoded.payload.uploadId).toBe(btoa('someBase64'));
        });

        it('handles multiple binaryKeys', () => {
            const codec3 = createJsonCodec(() => ['payload.chunk', 'payload.thumbnail']);
            const message = {
                payloadType: 1,
                clientMsgId: 'abc',
                payload: {chunk: makeChunk([1, 2, 3]), thumbnail: makeChunk([4, 5, 6])}
            };
            const decoded = codec3.decode(codec3.encode(message) as string) as typeof message;
            expect(Array.from(decoded.payload.chunk)).toEqual([1, 2, 3]);
            expect(Array.from(decoded.payload.thumbnail)).toEqual([4, 5, 6]);
        });

        it('returns empty keys for other message types — no conversion', () => {
            const UPLOAD_VIDEO_REQ = 100;
            const codecPerMsg = createJsonCodec<{
                payloadType: number;
                clientMsgId: string;
                payload: { chunk: Uint8Array | string }
            }>(
                message => message.payloadType === UPLOAD_VIDEO_REQ ? ['payload.chunk'] : [],
            );

            const uploadMsg = {payloadType: UPLOAD_VIDEO_REQ, clientMsgId: 'a', payload: {chunk: makeChunk([1, 2, 3])}};
            const decodedUpload = codecPerMsg.decode(codecPerMsg.encode(uploadMsg) as string) as typeof uploadMsg;
            expect(decodedUpload.payload.chunk).toBeInstanceOf(Uint8Array);

            const otherMsg = {payloadType: 999, clientMsgId: 'b', payload: {chunk: 'plain-string'}};
            const decodedOther = codecPerMsg.decode(codecPerMsg.encode(otherMsg) as string) as typeof otherMsg;
            expect(typeof decodedOther.payload.chunk).toBe('string');
            expect(decodedOther.payload.chunk).toBe('plain-string');
        });

        it('handles empty Uint8Array', () => {
            const message = {payloadType: 1, clientMsgId: 'abc', payload: {chunk: new Uint8Array(0)}};
            const decoded = codec.decode(codec.encode(message) as string) as typeof message;
            expect(decoded.payload.chunk).toBeInstanceOf(Uint8Array);
            expect(decoded.payload.chunk.length).toBe(0);
        });
    });

    describe('with nested binaryKeys', () => {
        const codec = createJsonCodec(() => ['payload.chunk']);
        const makeChunk = (values: number[]) => new Uint8Array(values);

        it('encodes nested Uint8Array field as base64 string', () => {
            const chunk = makeChunk([72, 101, 108, 108, 111]);
            const message = {payloadType: 1, clientMsgId: 'abc', payload: {chunk}};
            const parsed = JSON.parse(codec.encode(message) as string);
            expect(typeof parsed.payload.chunk).toBe('string');
            expect(parsed.payload.chunk).toBe(btoa('Hello'));
        });

        it('decodes nested base64 string back to Uint8Array', () => {
            const chunk = makeChunk([72, 101, 108, 108, 111]);
            const message = {payloadType: 1, clientMsgId: 'abc', payload: {chunk}};
            const decoded = codec.decode(codec.encode(message) as string) as typeof message;
            expect(decoded.payload.chunk).toBeInstanceOf(Uint8Array);
            expect(Array.from(decoded.payload.chunk)).toEqual([72, 101, 108, 108, 111]);
        });

        it('handles deeply nested paths', () => {
            const codecDeep = createJsonCodec(() => ['payload.data.binary']);
            const chunk = makeChunk([1, 2, 3]);
            const message = {clientMsgId: 'test', payload: {data: {binary: chunk}}};
            const decoded = codecDeep.decode(codecDeep.encode(message) as string) as typeof message;
            expect(decoded.payload.data.binary).toBeInstanceOf(Uint8Array);
            expect(Array.from(decoded.payload.data.binary)).toEqual([1, 2, 3]);
        });

        it('handles multiple nested binaryKeys', () => {
            const codecMulti = createJsonCodec(() => ['payload.chunk', 'payload.thumbnail']);
            const message = {
                payloadType: 1,
                clientMsgId: 'abc',
                payload: {chunk: makeChunk([1, 2, 3]), thumbnail: makeChunk([4, 5, 6])}
            };
            const decoded = codecMulti.decode(codecMulti.encode(message) as string) as typeof message;
            expect(Array.from(decoded.payload.chunk)).toEqual([1, 2, 3]);
            expect(Array.from(decoded.payload.thumbnail)).toEqual([4, 5, 6]);
        });

        it('round-trips nested large chunk (> 8192 bytes)', () => {
            const size = 20000;
            const original = new Uint8Array(size);
            for (let i = 0; i < size; i++) original[i] = i % 256;
            const message = {payloadType: 1, clientMsgId: 'abc', payload: {chunk: original}};
            const decoded = codec.decode(codec.encode(message) as string) as typeof message;
            expect(decoded.payload.chunk).toBeInstanceOf(Uint8Array);
            expect(decoded.payload.chunk.length).toBe(size);
            expect(Array.from(decoded.payload.chunk)).toEqual(Array.from(original));
        });

        it('does not affect non-binary nested fields', () => {
            const message = {payloadType: 42, clientMsgId: 'xyz', payload: {foo: 'bar', num: 123}};
            const decoded = codec.decode(codec.encode(message) as string) as typeof message;
            expect(decoded.payload.foo).toBe('bar');
            expect(decoded.payload.num).toBe(123);
        });

        it('handles empty nested Uint8Array', () => {
            const message = {payloadType: 1, clientMsgId: 'abc', payload: {chunk: new Uint8Array(0)}};
            const decoded = codec.decode(codec.encode(message) as string) as typeof message;
            expect(decoded.payload.chunk).toBeInstanceOf(Uint8Array);
            expect(decoded.payload.chunk.length).toBe(0);
        });
    });
});
