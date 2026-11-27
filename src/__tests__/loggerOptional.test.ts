import {readdirSync, readFileSync, statSync} from 'fs';
import {join} from 'path';

// @veksa/logger is an optional peer: a consumer that never installs it must still load the package.

const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
        return name === '__tests__' ? [] : sourceFiles(path);
    }

    return path.endsWith('.ts') ? [path] : [];
});

describe('@veksa/logger as an optional peer', () => {
    it('is imported for types only', () => {
        const valueImports = sourceFiles(join(__dirname, '..'))
            .filter(path => /^import\s+(?!type\b)[^;]*from\s+'@veksa\/logger'/m.test(readFileSync(path, 'utf8')));

        expect(valueImports).toEqual([]);
    });

    it('loads the entry and builds a codec when the logger is absent', () => {
        jest.isolateModules(() => {
            jest.doMock('@veksa/logger', () => {
                throw new Error('Cannot find module @veksa/logger');
            }, {virtual: true});
            jest.doMock('uuid', () => ({v4: () => 'id'}));

            const transport = require('../index');
            const codec = transport.createJsonCodec();

            expect(codec.decode(codec.encode({payloadType: 1, payload: {}}))).toEqual({payloadType: 1, payload: {}});
            expect(transport.TransportErrorCode).toBeDefined();
        });
    });
});
