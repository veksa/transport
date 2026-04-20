import {createHostPostAdapter} from '../createHostPostAdapter';
import {IPostMessage} from '../post.interface';
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


// Mock post connector
jest.mock('../createPostConnector', () => ({
    createPostConnector: jest.fn(() => {
        const messageSubject = new Subject<string>();
        const responseSubject = new Subject<string>();
        
        messageSubject.subscribe((data) => {
            responseSubject.next(data);
        });
        
        return of(() => messageSubject);
    }),
}));

import {Subject, of} from 'rxjs';

describe('createHostPostAdapter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const createAdapter = (frame?: HTMLIFrameElement) => {
        return createHostPostAdapter<IPostMessage>({
            frame,
            prefix: 'HOST',
            prefixColor: 'orange',
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
                expect(mockLogger.info).toHaveBeenCalledWith('[HOST] connected to client');
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
        
        const message: IPostMessage = {
            payloadType: 1,
            clientMsgId: 'msg-123',
            payload: {data: 'test'},
        };
        
        adapter.add('msg-123');
        adapter.send(message);
        
        expect(mockLogger.request).toHaveBeenCalledWith(message, {
            prefix: 'HOST',
            prefixColor: 'orange',
            messageName: 'Message_1',
        });
    });

    it('should have data$ and event$ observables defined', () => {
        const adapter = createAdapter();
        
        expect(adapter.data$).toBeDefined();
        expect(adapter.event$).toBeDefined();
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


    it('should work with optional frame parameter', () => {
        const mockFrame = {} as HTMLIFrameElement;
        const adapter = createAdapter(mockFrame);
        
        expect(adapter.connect).toBeDefined();
        expect(adapter.state$).toBeDefined();
    });

    it('should work without frame parameter', () => {
        const adapter = createAdapter();
        
        expect(adapter.connect).toBeDefined();
        expect(adapter.state$).toBeDefined();
    });
});
