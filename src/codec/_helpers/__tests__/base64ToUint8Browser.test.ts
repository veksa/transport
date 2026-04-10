import {base64ToUint8Browser} from '../base64ToUint8Browser';
import {uint8ToBase64Browser} from '../uint8ToBase64Browser';

describe('base64ToUint8Browser', () => {
    it('decodes known base64 correctly', () => {
        expect(Array.from(base64ToUint8Browser(btoa('Hello')))).toEqual([72, 101, 108, 108, 111]);
    });

    it('handles empty string', () => {
        expect(base64ToUint8Browser('').length).toBe(0);
    });

    it('round-trips 1-byte (2x padding)', () => {
        const input = new Uint8Array([255]);
        expect(Array.from(base64ToUint8Browser(uint8ToBase64Browser(input)))).toEqual([255]);
    });

    it('round-trips 2-byte (1x padding)', () => {
        const input = new Uint8Array([1, 2]);
        expect(Array.from(base64ToUint8Browser(uint8ToBase64Browser(input)))).toEqual([1, 2]);
    });

    it('round-trips 3-byte (no padding)', () => {
        const input = new Uint8Array([1, 2, 3]);
        expect(Array.from(base64ToUint8Browser(uint8ToBase64Browser(input)))).toEqual([1, 2, 3]);
    });

    it('round-trips large array (> 8192 bytes)', () => {
        const input = new Uint8Array(20000);
        for (let i = 0; i < 20000; i++) input[i] = i % 256;
        const result = base64ToUint8Browser(uint8ToBase64Browser(input));
        expect(result.length).toBe(20000);
        expect(Array.from(result)).toEqual(Array.from(input));
    });

    it('matches atob output', () => {
        const input = new Uint8Array([0, 1, 127, 128, 200, 255]);
        const base64 = btoa(String.fromCharCode(...input));
        const fromAtob = new Uint8Array([...atob(base64)].map(c => c.charCodeAt(0)));
        expect(Array.from(base64ToUint8Browser(base64))).toEqual(Array.from(fromAtob));
    });
});
