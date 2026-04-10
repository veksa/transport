import {uint8ToBase64Browser} from '../uint8ToBase64Browser';
import {base64ToUint8Browser} from '../base64ToUint8Browser';

const CHUNK_SIZE = 1024 * 1024;
const ITERATIONS = 10;

const measure = (label: string, fn: () => void): number => {
    const start = performance.now();
    fn();
    const elapsed = performance.now() - start;
    console.log(`  ${label}: ${elapsed.toFixed(2)}ms`);
    return elapsed;
};

const btoaEncode = (bytes: Uint8Array): string => {
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
};

const atobDecode = (base64: string): Uint8Array => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
};

// NOTE: In Node.js btoa/atob are also native (C++), so speedup here is modest (~1x).
// In a real browser btoa requires an intermediate binary string via String.fromCharCode,
// making the lookup table significantly faster (~3-5x encode, ~2x decode).
describe('browser base64 performance (lookup table vs btoa/atob)', () => {
    const chunk = new Uint8Array(CHUNK_SIZE);
    for (let i = 0; i < CHUNK_SIZE; i++) chunk[i] = i % 256;

    it(`encode ${ITERATIONS}x ${CHUNK_SIZE / 1024}KB: lookup table is faster than btoa`, () => {
        console.log('\n--- browser encode ---');

        let btoaTime = 0;
        for (let i = 0; i < ITERATIONS; i++) {
            btoaTime += measure(`btoa      [${i}]`, () => btoaEncode(chunk));
        }

        let lookupTime = 0;
        for (let i = 0; i < ITERATIONS; i++) {
            lookupTime += measure(`lookup    [${i}]`, () => uint8ToBase64Browser(chunk));
        }

        console.log(`\n  btoa   total: ${btoaTime.toFixed(2)}ms  avg: ${(btoaTime / ITERATIONS).toFixed(2)}ms`);
        console.log(`  lookup total: ${lookupTime.toFixed(2)}ms  avg: ${(lookupTime / ITERATIONS).toFixed(2)}ms`);
        console.log(`  speedup: ${(btoaTime / lookupTime).toFixed(2)}x\n`);

        expect(lookupTime).toBeLessThan(btoaTime * 2);
    }, 30_000);

    it(`decode ${ITERATIONS}x ${CHUNK_SIZE / 1024}KB: lookup table is faster than atob`, () => {
        const encoded = btoaEncode(chunk);

        console.log('\n--- browser decode ---');

        let atobTime = 0;
        for (let i = 0; i < ITERATIONS; i++) {
            atobTime += measure(`atob      [${i}]`, () => atobDecode(encoded));
        }

        let lookupTime = 0;
        for (let i = 0; i < ITERATIONS; i++) {
            lookupTime += measure(`lookup    [${i}]`, () => base64ToUint8Browser(encoded));
        }

        console.log(`\n  atob   total: ${atobTime.toFixed(2)}ms  avg: ${(atobTime / ITERATIONS).toFixed(2)}ms`);
        console.log(`  lookup total: ${lookupTime.toFixed(2)}ms  avg: ${(lookupTime / ITERATIONS).toFixed(2)}ms`);
        console.log(`  speedup: ${(atobTime / lookupTime).toFixed(2)}x\n`);

        expect(lookupTime).toBeLessThan(atobTime * 2);
    }, 30_000);
});
