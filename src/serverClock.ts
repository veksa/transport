/**
 * The server's clock and this device's, read at the same moment. Deadlines the server hands out (a token's end, a
 * link's expiry) are its milliseconds, and a device clock can be off by minutes or hours (set by hand, a time zone
 * set instead of the time), so they are compared on one clock.
 */
export interface IServerClock {
    /** The server's clock, epoch ms. */
    serverTime: number;
    /** This device's clock (`Date.now()`) at the moment the server read its own, epoch ms. */
    localTime: number;
}

const isTime = (value: unknown): value is number => {
    return typeof value === 'number' && Number.isFinite(value);
};

/**
 * A clock reading from a server time just received: the server read its clock about halfway through the round trip,
 * so the device clock it is paired with is `receivedAt - rtt / 2`. `undefined` for anything that is not a time.
 */
export const readServerClock = (serverTime: unknown, receivedAt: number, rtt = 0): IServerClock | undefined => {
    if (!isTime(serverTime) || !isTime(receivedAt)) {
        return undefined;
    }

    const halfTrip = isTime(rtt) && rtt > 0 ? rtt / 2 : 0;

    return {serverTime, localTime: receivedAt - halfTrip};
};

/** How far the server's clock runs ahead of this device's, ms (negative — behind); `undefined` before a reading. */
export const getServerClockOffset = (clock: Partial<IServerClock> | undefined): number | undefined => {
    if (!clock || !isTime(clock.serverTime) || !isTime(clock.localTime)) {
        return undefined;
    }

    return clock.serverTime - clock.localTime;
};

/** «Now» by the server's clock; the device's own clock before the first reading. */
export const getServerNow = (clock: Partial<IServerClock> | undefined, now: number = Date.now()): number => {
    return now + (getServerClockOffset(clock) ?? 0);
};

/** A server time on this device's clock: what to compare with `Date.now()` or to wait for with a timer. */
export const toLocalTime = (clock: Partial<IServerClock> | undefined, serverTime: number): number => {
    return serverTime - (getServerClockOffset(clock) ?? 0);
};
