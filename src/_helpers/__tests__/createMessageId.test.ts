import {readdirSync, readFileSync, statSync} from 'fs';
import {join} from 'path';
import {Subject, BehaviorSubject} from 'rxjs';
import {createMessageId} from '../createMessageId';
import {sendRequest} from '../sendRequest';
import {IMessage, ITransportAdapter, TransportState} from '../../interfaces';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
        return name === '__tests__' ? [] : sourceFiles(path);
    }

    return path.endsWith('.ts') ? [path] : [];
});

/** Runs `body` on a runtime without the Web Crypto global, the way Hermes (React Native) is. */
const withoutWebCrypto = (body: () => void): void => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

    Object.defineProperty(globalThis, 'crypto', {value: undefined, configurable: true, writable: true});

    try {
        body();
    } finally {
        if (descriptor) {
            Object.defineProperty(globalThis, 'crypto', descriptor);
        } else {
            delete (globalThis as {crypto?: unknown}).crypto;
        }
    }
};

describe('createMessageId', () => {
    it('makes a version 4 uuid with web crypto', () => {
        expect(createMessageId()).toMatch(UUID_V4);
    });

    it('makes distinct version 4 uuids on a runtime without the crypto global', () => {
        withoutWebCrypto(() => {
            const ids = new Set(Array.from({length: 1000}, () => createMessageId()));

            expect(ids.size).toBe(1000);
            ids.forEach(id => expect(id).toMatch(UUID_V4));
        });
    });

    it('uses getRandomValues when randomUUID is missing', () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
        const getRandomValues = jest.fn(<T extends Uint8Array>(array: T): T => array.fill(0xff));

        Object.defineProperty(globalThis, 'crypto', {value: {getRandomValues}, configurable: true, writable: true});

        try {
            expect(createMessageId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
            expect(getRandomValues).toHaveBeenCalledTimes(1);
        } finally {
            Object.defineProperty(globalThis, 'crypto', descriptor!);
        }
    });

    it('tags a request without a clientMsgId on a runtime without the crypto global', () => {
        withoutWebCrypto(() => {
            const sent: IMessage[] = [];
            const adapter = {
                state$: new BehaviorSubject(TransportState.Connected),
                data$: new Subject<IMessage>(),
                add: () => undefined,
                drop: () => undefined,
                send: (message: IMessage) => sent.push(message),
            } as unknown as ITransportAdapter<IMessage, IMessage, IMessage>;

            const subscription = sendRequest(adapter, {payload: {}} as unknown as IMessage).subscribe();

            subscription.unsubscribe();

            expect(sent).toHaveLength(1);
            expect(sent[0].clientMsgId).toMatch(UUID_V4);
        });
    });

    it('never reads the crypto global bare or depends on a uuid library', () => {
        const offenders = sourceFiles(join(__dirname, '..', '..'))
            .filter(path => {
                const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

                return /(^|[^.\w$])crypto\s*\./m.test(code) || /from\s+'uuid'/.test(code);
            });
        const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8'));

        expect(offenders).toEqual([]);
        expect(Object.keys(pkg.dependencies ?? {})).not.toContain('uuid');
    });
});
