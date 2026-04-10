import {createJsonCodec} from '../createJsonCodec';

const CHUNK_SIZE = 1024 * 1024;
const ITERATIONS = 10;

const makeMessage = (chunk: Uint8Array) => ({
    payloadType: 100,
    clientMsgId: 'perf-test',
    payload: {
        postEpisodeId: 42,
        uploadId: 'upload-123',
        chunkIndex: 0,
        chunk,
        isLastChunk: false,
    },
});

const measure = (label: string, fn: () => void): number => {
    const start = performance.now();
    fn();
    const elapsed = performance.now() - start;
    console.log(`  ${label}: ${elapsed.toFixed(2)}ms`);
    return elapsed;
};

describe('createJsonCodec performance', () => {
    const chunk = new Uint8Array(CHUNK_SIZE);
    for (let i = 0; i < CHUNK_SIZE; i++) chunk[i] = i % 256;

    const message = makeMessage(chunk);

    it(`encode ${ITERATIONS}x ${CHUNK_SIZE / 1024}KB chunk: binaryKeys codec is faster than default`, () => {
        const defaultCodec = createJsonCodec();
        const binaryCodec = createJsonCodec(() => ['chunk']);

        console.log('\n--- encode ---');

        let defaultTime = 0;
        for (let i = 0; i < ITERATIONS; i++) {
            defaultTime += measure(`default    [${i}]`, () => defaultCodec.encode(message));
        }

        let binaryTime = 0;
        for (let i = 0; i < ITERATIONS; i++) {
            binaryTime += measure(`binaryKeys [${i}]`, () => binaryCodec.encode(message));
        }

        console.log(`\n  default    total: ${defaultTime.toFixed(2)}ms  avg: ${(defaultTime / ITERATIONS).toFixed(2)}ms`);
        console.log(`  binaryKeys total: ${binaryTime.toFixed(2)}ms  avg: ${(binaryTime / ITERATIONS).toFixed(2)}ms`);
        console.log(`  speedup: ${(defaultTime / binaryTime).toFixed(2)}x\n`);

        expect(binaryTime).toBeLessThan(defaultTime);
    }, 30_000);

    it(`decode ${ITERATIONS}x ${CHUNK_SIZE / 1024}KB chunk: binaryKeys codec is faster than default`, () => {
        const defaultCodec = createJsonCodec();
        const binaryCodec = createJsonCodec(() => ['chunk']);

        const defaultEncoded = defaultCodec.encode(message) as string;
        const binaryEncoded = binaryCodec.encode(message) as string;

        console.log('\n--- decode ---');

        let defaultTime = 0;
        for (let i = 0; i < ITERATIONS; i++) {
            defaultTime += measure(`default    [${i}]`, () => defaultCodec.decode(defaultEncoded));
        }

        let binaryTime = 0;
        for (let i = 0; i < ITERATIONS; i++) {
            binaryTime += measure(`binaryKeys [${i}]`, () => binaryCodec.decode(binaryEncoded));
        }

        console.log(`\n  default    total: ${defaultTime.toFixed(2)}ms  avg: ${(defaultTime / ITERATIONS).toFixed(2)}ms`);
        console.log(`  binaryKeys total: ${binaryTime.toFixed(2)}ms  avg: ${(binaryTime / ITERATIONS).toFixed(2)}ms`);
        console.log(`  speedup: ${(defaultTime / binaryTime).toFixed(2)}x\n`);

        expect(binaryTime).toBeLessThan(defaultTime);
    }, 30_000);
});
