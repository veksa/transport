import {base64ToUint8} from './base64ToUint8';

export const patchBinaryFields = (obj: Record<string, unknown>, keysSet: Set<string>): void => {
    for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (keysSet.has(key) && typeof value === 'string') {
            obj[key] = base64ToUint8(value);
        } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            patchBinaryFields(value as Record<string, unknown>, keysSet);
        }
    }
};
