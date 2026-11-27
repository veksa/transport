import {IRoutingOptions} from '../supervisor.interface';

export const routingDefaults = {
    failuresToLeave: 2,
    failureWindow: 10 * 60 * 1000,
    retryPrimaryAfter: 24 * 60 * 60 * 1000,
    failuresToReturn: 3,
    storageKey: 'transport.route',
};

interface ISavedRoute {
    address: string;
    until: number;
}

export interface IRouter {
    /** Resolved once the saved choice is read; `undefined` when there is nothing to wait for. */
    ready: Promise<void> | undefined;
    /** The address to dial now. */
    current: () => string | undefined;
    index: () => number;
    /** A dial that never opened, or an open connection whose liveness echo never came. */
    failed: () => void;
    /** A connection on the current address closed after being open this long. */
    served: (openFor: number) => void;
}

/**
 * Picks the address to dial among a primary and its fallbacks, by what happened rather than by guessing the network:
 * `failuresToLeave` failures of the primary within `failureWindow` move the client to the next address, and it stays
 * there `retryPrimaryAfter` (across launches when there is a storage) before the primary is tried again.
 * `failuresToReturn` failures in a row on a fallback move it on, past the last one back to the primary; a fallback
 * connection that served longer than `failureWindow` clears that count.
 */
export const createRouter = (
    addresses: string[] | undefined,
    options: IRoutingOptions | undefined,
    onRoute: (address: string, index: number) => void,
): IRouter => {
    const list = addresses ?? [];
    const {failuresToLeave, failureWindow, retryPrimaryAfter, failuresToReturn, storageKey} = {...routingDefaults, ...options};
    const storage = options?.storage;

    let index = 0;
    let until = 0;
    let primaryFailures: number[] = [];
    let fallbackFailures = 0;

    const save = () => {
        if (!storage) {
            return;
        }

        const value = index === 0 ? undefined : JSON.stringify({address: list[index], until} satisfies ISavedRoute);

        try {
            Promise.resolve(storage.write(storageKey, value)).catch(() => undefined);
        } catch {
            // A storage that cannot write costs the choice on the next launch, not the connection.
        }
    };

    const move = (next: number) => {
        index = next;
        until = next === 0 ? 0 : Date.now() + retryPrimaryAfter;
        primaryFailures = [];
        fallbackFailures = 0;

        save();
        onRoute(list[index], index);
    };

    const restore = (raw: string | undefined | null) => {
        if (!raw) {
            return;
        }

        try {
            const saved = JSON.parse(raw) as Partial<ISavedRoute>;
            const savedIndex = typeof saved.address === 'string' ? list.indexOf(saved.address) : -1;

            if (savedIndex > 0 && typeof saved.until === 'number' && saved.until > Date.now()) {
                index = savedIndex;
                until = saved.until;
                onRoute(list[index], index);
            }
        } catch {
            // An unreadable saved choice is no choice.
        }
    };

    let ready: Promise<void> | undefined;

    if (storage && list.length > 1) {
        try {
            const raw = storage.read(storageKey);

            if (raw instanceof Promise) {
                ready = raw.then(restore, () => undefined);
            } else {
                restore(raw);
            }
        } catch {
            // As above: start on the primary.
        }
    }

    return {
        get ready() {
            return ready;
        },
        current: () => {
            if (list.length === 0) {
                return undefined;
            }

            // The fallback's term is over: the primary gets another chance.
            if (index !== 0 && until <= Date.now()) {
                move(0);
            }

            return list[index];
        },
        index: () => index,
        failed: () => {
            if (list.length < 2) {
                return;
            }

            if (index === 0) {
                const now = Date.now();

                primaryFailures = [...primaryFailures.filter(at => now - at < failureWindow), now];

                if (primaryFailures.length >= failuresToLeave) {
                    move(1);
                }

                return;
            }

            fallbackFailures++;

            if (fallbackFailures >= failuresToReturn) {
                move((index + 1) % list.length);
            }
        },
        served: openFor => {
            if (index !== 0 && openFor > failureWindow) {
                fallbackFailures = 0;
            }
        },
    };
};
