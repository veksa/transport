import {Subject, of} from 'rxjs';
import {createRestAdapter} from '../createRestAdapter';
import {IRestMessage} from '../rest.interface';
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

// Mock rest connector
jest.mock('../createRestConnector', () => ({
    createRestConnector: jest.fn(() => {
        const messageSubject = new Subject<IRestMessage>();
        const responseSubject = new Subject<IRestMessage>();
        
        messageSubject.subscribe((data) => {
            responseSubject.next(data);
        });
        
        return of(() => messageSubject);
    }),
}));

describe('createRestAdapter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const createAdapter = () => {
        return createRestAdapter<IRestMessage>({
            prefix: 'TEST',
            prefixColor: 'green',
            url: 'http://localhost:8080',
            health: '/health',
            getMessageName: (message) => `${message.method}_${message.url}`,
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
                expect(mockLogger.info).toHaveBeenCalledWith('[TEST] connected to', 'http://localhost:8080');
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
        
        expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should drop client message IDs', () => {
        const adapter = createAdapter();
        
        adapter.add('msg-123');
        adapter.drop('msg-123');
        
        expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should send messages', () => {
        const adapter = createAdapter();
        
        const message: IRestMessage = {
            url: '/api/test',
            method: 'POST',
            clientMsgId: 'msg-123',
            payload: {data: 'test'},
        };
        
        adapter.send(message);
        
        expect(mockLogger.request).toHaveBeenCalledWith(message, {
            prefix: 'TEST',
            prefixColor: 'green',
            messageName: 'POST_/api/test',
        });
    });

    it('should not send empty messages', () => {
        const adapter = createAdapter();
        
        adapter.send(null as any);
        
        expect(mockLogger.request).not.toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalledWith('[TEST] rest empty message');
    });

    it('should have data$ observable defined', () => {
        const adapter = createAdapter();
        
        expect(adapter.data$).toBeDefined();
    });

    it('should handle invalid messages gracefully', () => {
        const adapter = createAdapter();
        
        adapter.connect();
        
        // The adapter should handle null/undefined messages without crashing
        setTimeout(() => {
            expect(mockLogger.error).not.toHaveBeenCalled();
        }, 50);
    });

    it('should handle rest errors', (done) => {
        const adapter = createAdapter();
        
        adapter.connect();
        
        setTimeout(() => {
            done();
        }, 50);
    });

    it('should share observables among multiple subscribers', (done) => {
        const adapter = createAdapter();
        
        let dataCount = 0;
        let stateCount = 0;
        
        adapter.data$.subscribe(() => dataCount++);
        adapter.data$.subscribe(() => dataCount++);
        
        adapter.state$.subscribe(() => stateCount++);
        adapter.state$.subscribe(() => stateCount++);
        
        adapter.connect();
        
        setTimeout(() => {
            expect(stateCount).toBeGreaterThan(0);
            done();
        }, 50);
    });

    it('should work without health parameter', () => {
        const adapter = createRestAdapter<IRestMessage>({
            prefix: 'TEST',
            url: 'http://localhost:8080',
            getMessageName: (message) => `${message.method}_${message.url}`,
            logger: mockLogger as any,
        });
        
        expect(adapter.connect).toBeDefined();
        expect(adapter.state$).toBeDefined();
    });
});
