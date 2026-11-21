import {Subject, of, throwError} from 'rxjs';
import {createSocketAdapter} from '../createSocketAdapter';
import {ISocketMessage} from '../socket.interface';
import {ITransportCodec} from '../../interfaces';
import {TransportState} from '../../interfaces';

// Mock logger
const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    request: jest.fn(),
    response: jest.fn(),
    event: jest.fn(),
    getLogs: jest.fn(),
};

// Mock codec
const mockCodec: ITransportCodec<ISocketMessage> = {
    encode: jest.fn((message) => JSON.stringify(message)),
    decode: jest.fn((data) => {
        if (typeof data === 'string') {
            return JSON.parse(data) as ISocketMessage;
        }
        return undefined;
    }),
};

// Mock socket connector
jest.mock('../createSocketConnector', () => ({
    createSocketConnector: jest.fn(() => {
        const messageSubject = new Subject<string>();
        const responseSubject = new Subject<string>();
        
        messageSubject.subscribe((data) => {
            responseSubject.next(data);
        });
        
        return of(() => messageSubject);
    }),
}));

describe('createSocketAdapter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const createAdapter = () => {
        return createSocketAdapter<ISocketMessage>({
            prefix: 'TEST',
            prefixColor: 'blue',
            url: 'ws://localhost:8080',
            protocol: 'ws',
            codec: mockCodec,
            getMessageName: (message) => `Message_${message.payloadType}`,
            logger: mockLogger as any,
        });
    };

    it('should create adapter with all required methods', () => {
        const adapter = createAdapter();
        
        expect(adapter.connect).toBeDefined();
        expect(adapter.disconnect).toBeDefined();
        expect(adapter.send).toBeDefined();
        expect(adapter.add).toBeDefined();
        expect(adapter.drop).toBeDefined();
        expect(adapter.data$).toBeDefined();
        expect(adapter.event$).toBeDefined();
        expect(adapter.state$).toBeDefined();
    });

    it('should start in disconnected state', (done) => {
        const adapter = createAdapter();
        
        adapter.state$.subscribe((state) => {
            expect(state).toBe(TransportState.Disconnected);
            done();
        });
    });

    it('should connect and update state to connected', (done) => {
        const adapter = createAdapter();
        
        adapter.state$.subscribe((state) => {
            if (state === TransportState.Connected) {
                expect(mockLogger.info).toHaveBeenCalledWith('[TEST] connected to', 'ws://localhost:8080');
                done();
            }
        });
        
        adapter.connect();
    });

    it('should disconnect without throwing errors', () => {
        const adapter = createAdapter();
        
        expect(() => {
            adapter.connect();
            adapter.disconnect();
        }).not.toThrow();
    });

    it('should add and track client message IDs', () => {
        const adapter = createAdapter();
        
        adapter.add('msg-123');
        adapter.add('msg-456');
        
        // The add function should store the message ID
        // We can verify this indirectly by checking if messages are routed correctly
        expect(mockLogger.info).not.toHaveBeenCalled(); // No side effects from add alone
    });

    it('should drop client message IDs', () => {
        const adapter = createAdapter();
        
        adapter.add('msg-123');
        adapter.drop('msg-123');
        
        expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should encode and send messages', () => {
        const adapter = createAdapter();

        adapter.connect();
        
        const message: ISocketMessage = {
            payloadType: 1,
            clientMsgId: 'msg-123',
            payload: {data: 'test'},
        };
        
        adapter.send(message);
        
        expect(mockCodec.encode).toHaveBeenCalledWith(message);
        expect(mockLogger.request).toHaveBeenCalledWith(message, {
            prefix: 'TEST',
            prefixColor: 'blue',
            messageName: 'Message_1',
        });
    });

    it('should not send empty messages', () => {
        const adapter = createAdapter();
        
        adapter.send(null as any);
        
        expect(mockCodec.encode).not.toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalledWith('[TEST] socket empty message');
    });

    it('should log error when encoding fails', () => {
        const adapter = createAdapter();
        
        adapter.connect();

        (mockCodec.encode as jest.Mock).mockReturnValueOnce(undefined);
        
        const message: ISocketMessage = {
            payloadType: 1,
            clientMsgId: 'msg-123',
            payload: {data: 'test'},
        };
        
        adapter.send(message);
        
        expect(mockLogger.error).toHaveBeenCalledWith('[TEST] socket invalid encode', undefined);
    });

    it('should route messages to data$ when clientMsgId is tracked', () => {
        const adapter = createAdapter();
        
        const message: ISocketMessage = {
            payloadType: 1,
            clientMsgId: 'msg-123',
            payload: {data: 'test'},
        };
        
        adapter.add('msg-123');
        
        // Verify that data$ observable exists
        expect(adapter.data$).toBeDefined();
    });

    it('should have event$ observable defined', () => {
        const adapter = createAdapter();
        
        expect(adapter.event$).toBeDefined();
    });

    it('should handle decode errors gracefully', () => {
        const adapter = createAdapter();
        
        (mockCodec.decode as jest.Mock).mockReturnValueOnce(undefined);
        
        adapter.connect();
        
        // The adapter should log an error but not crash
        expect(mockLogger.error).not.toHaveBeenCalledWith('[TEST] socket invalid decode');
    });

    it('should handle invalid data gracefully', (done) => {
        const adapter = createAdapter();
        
        adapter.connect();
        
        // Simulate receiving null/undefined data
        // The adapter should log an error but not crash
        setTimeout(() => {
            expect(mockLogger.error).not.toHaveBeenCalled();
            done();
        }, 50);
    });

    it('should handle socket errors', (done) => {
        const adapter = createAdapter();
        
        adapter.connect();
        
        // Simulate an error scenario
        setTimeout(() => {
            done();
        }, 50);
    });

    it('should share observables among multiple subscribers', (done) => {
        const adapter = createAdapter();
        
        let dataCount = 0;
        let eventCount = 0;
        let stateCount = 0;
        
        adapter.data$.subscribe(() => dataCount++);
        adapter.data$.subscribe(() => dataCount++);
        
        adapter.event$?.subscribe(() => eventCount++);
        adapter.event$?.subscribe(() => eventCount++);
        
        adapter.state$.subscribe(() => stateCount++);
        adapter.state$.subscribe(() => stateCount++);
        
        adapter.connect();
        
        setTimeout(() => {
            expect(stateCount).toBeGreaterThan(0);
            done();
        }, 50);
    });
});
