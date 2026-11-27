import {IReconnectOptions} from '../supervisor.interface';

export const reconnectDefaults: Required<IReconnectOptions> = {
    minDelay: 1000,
    maxDelay: 30_000,
    factor: 2,
    jitter: 0.5,
    stableAfter: 10_000,
    maxAttempts: Infinity,
};

/**
 * The wait before attempt number `attempt` of a row of failures. Attempt 0 (a first dial, a wake) goes out at once;
 * attempt n waits `min(maxDelay, minDelay · factor^(n−1))`, of which the `jitter` share is random.
 */
export const getReconnectDelay = (attempt: number, options: Required<IReconnectOptions>, random: () => number): number => {
    if (attempt <= 0) {
        return 0;
    }

    const base = Math.min(options.maxDelay, options.minDelay * Math.pow(options.factor, attempt - 1));
    const jitter = Math.min(1, Math.max(0, options.jitter));

    return Math.round(base * (1 - jitter * random()));
};
