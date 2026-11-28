import {getServerClockOffset, getServerNow, readServerClock, toLocalTime} from '../serverClock';

const hour = 60 * 60 * 1000;
const serverClock = Date.UTC(2030, 0, 15, 12, 0, 0);

describe('readServerClock', () => {
    it('pairs the server time with the device clock halfway through the round trip', () => {
        expect(readServerClock(serverClock, 1_000_200, 400)).toEqual({serverTime: serverClock, localTime: 1_000_000});
    });

    it('pairs it with the moment of receipt when the round trip is unknown or nonsense', () => {
        expect(readServerClock(serverClock, 1_000_000)).toEqual({serverTime: serverClock, localTime: 1_000_000});
        expect(readServerClock(serverClock, 1_000_000, -5)).toEqual({serverTime: serverClock, localTime: 1_000_000});
        expect(readServerClock(serverClock, 1_000_000, NaN)).toEqual({serverTime: serverClock, localTime: 1_000_000});
    });

    it('gives no reading for anything that is not a time', () => {
        expect(readServerClock(undefined, 1_000_000)).toBeUndefined();
        expect(readServerClock(String(serverClock), 1_000_000)).toBeUndefined();
        expect(readServerClock(NaN, 1_000_000)).toBeUndefined();
        expect(readServerClock(Infinity, 1_000_000)).toBeUndefined();
    });
});

describe('getServerNow', () => {
    it('takes the server clock from the last reading when the device runs two hours ahead', () => {
        const deviceClock = serverClock + 2 * hour;
        const clock = {serverTime: serverClock, localTime: deviceClock};

        expect(getServerNow(clock, deviceClock + 10_000)).toBe(serverClock + 10_000);
        expect(getServerClockOffset(clock)).toBe(-2 * hour);
    });

    it('falls back to the device clock before the first reading', () => {
        expect(getServerNow(undefined, serverClock)).toBe(serverClock);
        expect(getServerNow({}, serverClock)).toBe(serverClock);
        expect(getServerNow({serverTime: serverClock}, serverClock + hour)).toBe(serverClock + hour);
        expect(getServerClockOffset(undefined)).toBeUndefined();
        expect(getServerClockOffset({serverTime: serverClock})).toBeUndefined();
    });

    it('uses Date.now() when no now is given', () => {
        const spy = jest.spyOn(Date, 'now').mockReturnValue(serverClock + hour);

        try {
            expect(getServerNow({serverTime: serverClock, localTime: serverClock + hour})).toBe(serverClock);
        } finally {
            spy.mockRestore();
        }
    });
});

describe('toLocalTime', () => {
    it('keeps a fresh link alive on a device clock two hours ahead of the server', () => {
        const deviceClock = serverClock + 2 * hour;
        const linkEnd = toLocalTime({serverTime: serverClock, localTime: deviceClock}, serverClock + hour);

        expect(linkEnd).toBe(deviceClock + hour);
        expect(linkEnd).toBeGreaterThan(deviceClock);
    });

    it('moves a server deadline onto a device clock that runs behind', () => {
        const deviceClock = serverClock - 3 * hour;

        expect(toLocalTime({serverTime: serverClock, localTime: deviceClock}, serverClock + hour)).toBe(deviceClock + hour);
    });

    it('leaves a deadline as it is before the first reading', () => {
        expect(toLocalTime(undefined, serverClock + hour)).toBe(serverClock + hour);
    });
});
