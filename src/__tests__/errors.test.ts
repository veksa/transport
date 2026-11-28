import {getErrorCode, getErrorDescription} from '../errors';
import {TransportErrorCode} from '../interfaces';

describe('getErrorCode', () => {
    it('reads the code of a refusal and of a transport failure', () => {
        expect(getErrorCode({errorCode: 'NOT_FOUND', description: 'x'})).toBe('NOT_FOUND');
        expect(getErrorCode({errorCode: TransportErrorCode.ClosedConnection})).toBe('ClosedConnection');
    });

    it('gives no code for an ordinary exception or anything that is not a code', () => {
        expect(getErrorCode(new Error('boom'))).toBeUndefined();
        expect(getErrorCode(undefined)).toBeUndefined();
        expect(getErrorCode(null)).toBeUndefined();
        expect(getErrorCode('NOT_FOUND')).toBeUndefined();
        expect(getErrorCode({errorCode: 42})).toBeUndefined();
        expect(getErrorCode({errorCode: ''})).toBeUndefined();
    });
});

describe('getErrorDescription', () => {
    it('reads the description the other side gave', () => {
        expect(getErrorDescription({errorCode: 'NOT_EMPTY', description: 'Delete the items first'})).toBe('Delete the items first');
    });

    it('keeps the text as it came, spaces included', () => {
        expect(getErrorDescription({errorCode: 'NOT_OPENED', description: ' Alice, Bob '})).toBe(' Alice, Bob ');
    });

    it('treats an empty or blank description as none', () => {
        expect(getErrorDescription({errorCode: 'NOT_OPENED', description: ''})).toBeUndefined();
        expect(getErrorDescription({errorCode: 'NOT_OPENED', description: '  \n'})).toBeUndefined();
    });

    it('gives nothing for a value that is not an error payload', () => {
        expect(getErrorDescription(undefined)).toBeUndefined();
        expect(getErrorDescription(null)).toBeUndefined();
        expect(getErrorDescription('Delete the items first')).toBeUndefined();
        expect(getErrorDescription({errorCode: 'X'})).toBeUndefined();
        expect(getErrorDescription({errorCode: 'X', description: 7})).toBeUndefined();
    });

    it('never passes on the diagnostic of a transport failure as something the other side said', () => {
        expect(getErrorDescription({errorCode: TransportErrorCode.ClosedConnection, description: '1 was not sent. Connection is closed'})).toBeUndefined();
        expect(getErrorDescription({errorCode: TransportErrorCode.RequestTimeout, description: '1 got no reply in 20000 ms'})).toBeUndefined();
    });
});
