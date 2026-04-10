/**
 * @jest-environment jsdom
 *
 * Simulates browser base64 behavior by using pure-JS btoa/atob implementations
 * (no native C++ Buffer), giving a realistic comparison against the lookup table.
 */
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

// Pure-JS btoa simulation: no native C++ — this is what browsers actually do
const jsEncode = (bytes: Uint8Array): string => {
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    // Inline base64 encoding without native btoa
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    for (let i = 0; i < binary.length; i += 3) {
        const b0 = binary.charCodeAt(i);
        const b1 = binary.charCodeAt(i + 1);
        const b2 = binary.charCodeAt(i + 2);
        result += chars[b0 >> 2];
        result += chars[((b0 & 3) << 4) | (b1 >> 4)];
        result += i + 1 < binary.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
        result += i + 2 < binary.length ? chars[b2 & 63] : '=';
    }
    return result;
};

// Pure-JS atob simulation
const jsDecode = (base64: string): Uint8Array => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup: Record<string, number> = {};
    for (let i = 0; i < 64; i++) lookup[chars[i]] = i;
    const padding = base64[base64.length - 1] === '=' ? (base64[base64.length - 2] === '=' ? 2 : 1) : 0;
    const out = new Uint8Array((base64.length * 3) / 4 - padding);
    let j = 0;
    for (let i = 0; i < base64.length; i += 4) {
        const v0 = lookup[base64[i]];
        const v1 = lookup[base64[i + 1]];
        const v2 = lookup[base64[i + 2]];
        const v3 = lookup[base64[i + 3]];
        out[j++] = (v0 << 2) | (v1 >> 4);
        if (base64[i + 2] !== '=') out[j++] = ((v1 & 15) << 4) | (v2 >> 2);
        if (base64[i + 3] !== '=') out[j++] = ((v2 & 3) << 6) | v3;
    }
    return out;
};

describe('browser base64 performance in jsdom (lookup table vs btoa/atob)', () => {
    const chunk = new Uint8Array(CHUNK_SIZE);
    for (let i = 0; i < CHUNK_SIZE; i++) chunk[i] = i % 256;

    it(`encode ${ITERATIONS}x ${CHUNK_SIZE / 1024}KB: lookup table vs pure-JS btoa`, () => {
        console.log('\n--- jsdom encode (pure-JS btoa vs lookup table) ---');

        let jsTime = 0;
        for (let i = 0; i < ITERATIONS; i++) {
            jsTime += measure(`pure-JS   [${i}]`, () => jsEncode(chunk));
        }

        let lookupTime = 0;
        for (let i = 0; i < ITERATIONS; i++) {
            lookupTime += measure(`lookup    [${i}]`, () => uint8ToBase64Browser(chunk));
        }

        console.log(`\n  pure-JS total: ${jsTime.toFixed(2)}ms  avg: ${(jsTime / ITERATIONS).toFixed(2)}ms`);
        console.log(`  lookup  total: ${lookupTime.toFixed(2)}ms  avg: ${(lookupTime / ITERATIONS).toFixed(2)}ms`);
        console.log(`  speedup: ${(jsTime / lookupTime).toFixed(2)}x\n`);

        expect(lookupTime).toBeLessThan(jsTime);
    }, 60_000);

    it(`decode ${ITERATIONS}x ${CHUNK_SIZE / 1024}KB: lookup table vs pure-JS atob`, () => {
        const encoded = jsEncode(chunk);

        console.log('\n--- jsdom decode (pure-JS atob vs lookup table) ---');

        let jsTime = 0;
        for (let i = 0; i < ITERATIONS; i++) {
            jsTime += measure(`pure-JS   [${i}]`, () => jsDecode(encoded));
        }

        let lookupTime = 0;
        for (let i = 0; i < ITERATIONS; i++) {
            lookupTime += measure(`lookup    [${i}]`, () => base64ToUint8Browser(encoded));
        }

        console.log(`\n  pure-JS total: ${jsTime.toFixed(2)}ms  avg: ${(jsTime / ITERATIONS).toFixed(2)}ms`);
        console.log(`  lookup  total: ${lookupTime.toFixed(2)}ms  avg: ${(lookupTime / ITERATIONS).toFixed(2)}ms`);
        console.log(`  speedup: ${(jsTime / lookupTime).toFixed(2)}x\n`);

        expect(lookupTime).toBeLessThan(jsTime);
    }, 60_000);
});
