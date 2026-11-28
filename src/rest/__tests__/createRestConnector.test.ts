import {Subject} from 'rxjs';
import {createRestConnector, restErrorUrl} from '../createRestConnector';
import {IRestMessage} from '../rest.interface';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const respond = (status: number, body: string) => ({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve().then(() => JSON.parse(body)),
});

describe('createRestConnector', () => {
    const realFetch = global.fetch;

    afterEach(() => {
        global.fetch = realFetch;
    });

    it('answers a failed request whose body is not JSON with an error reply and keeps serving', async () => {
        const bodies = [respond(502, '<html>Bad gateway</html>'), respond(200, '{"ok":true}')];

        global.fetch = jest.fn(() => Promise.resolve(bodies.shift())) as unknown as typeof fetch;

        const input$ = new Subject<IRestMessage>();
        const replies: IRestMessage[] = [];
        const failure = jest.fn();

        createRestConnector<IRestMessage>('http://api.example.test').subscribe({
            next: getResponses => getResponses(input$).subscribe(reply => replies.push(reply)),
            error: failure,
        });

        input$.next({url: '/a', method: 'get', headers: {}, payload: {}, clientMsgId: 'a'} as IRestMessage);
        await settle();
        input$.next({url: '/b', method: 'get', headers: {}, payload: {}, clientMsgId: 'b'} as IRestMessage);
        await settle();

        expect(failure).not.toHaveBeenCalled();
        expect(replies).toEqual([
            expect.objectContaining({url: restErrorUrl, clientMsgId: 'a', payload: expect.objectContaining({errorStatus: 502})}),
            expect.objectContaining({url: '/b', clientMsgId: 'b', payload: {ok: true}}),
        ]);
    });
});
