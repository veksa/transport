import {uint8ToBase64Browser} from '../uint8ToBase64Browser';
import {base64ToUint8Browser} from '../base64ToUint8Browser';

describe('uint8ToBase64Browser', () => {
    it('encodes known bytes correctly', () => {
        expect(uint8ToBase64Browser(new Uint8Array([72, 101, 108, 108, 111]))).toBe(btoa('Hello'));
    });

    it('matches btoa output', () => {
        const input = new Uint8Array([0, 1, 127, 128, 200, 255]);
        expect(uint8ToBase64Browser(input)).toBe(btoa(String.fromCharCode(...input)));
    });

    it('handles empty array', () => {
        expect(uint8ToBase64Browser(new Uint8Array(0))).toBe('');
    });

    it('handles 1-byte input (2x padding ==)', () => {
        const input = new Uint8Array([255]);
        expect(uint8ToBase64Browser(input)).toBe(btoa(String.fromCharCode(255)));
    });

    it('handles 2-byte input (1x padding =)', () => {
        const input = new Uint8Array([1, 2]);
        expect(uint8ToBase64Browser(input)).toBe(btoa(String.fromCharCode(1, 2)));
    });

    it('handles 3-byte input (no padding)', () => {
        const input = new Uint8Array([1, 2, 3]);
        expect(uint8ToBase64Browser(input)).toBe(btoa(String.fromCharCode(1, 2, 3)));
    });

    it('round-trips large array (> 8192 bytes)', () => {
        const input = new Uint8Array(20000);
        for (let i = 0; i < 20000; i++) input[i] = i % 256;
        const result = base64ToUint8Browser(uint8ToBase64Browser(input));
        expect(result.length).toBe(20000);
        expect(Array.from(result)).toEqual(Array.from(input));
    });
});
