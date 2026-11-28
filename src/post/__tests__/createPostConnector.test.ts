/**
 * @jest-environment jsdom
 */
import {Subject} from 'rxjs';
import {createPostConnector} from '../createPostConnector';
import {IPostMessage} from '../post.interface';

const makeFrame = () => {
    const frame = document.createElement('iframe');

    document.body.appendChild(frame);

    return frame;
};

const listen = (type: 'message-to-host' | 'message-from-host', frame?: HTMLIFrameElement) => {
    const received: IPostMessage[] = [];
    const subscription = createPostConnector<IPostMessage>(type, frame).subscribe(getResponses => {
        getResponses(new Subject<IPostMessage>()).subscribe(message => received.push(message));
    });

    return {received, stop: () => subscription.unsubscribe()};
};

const post = (type: string, data: IPostMessage, source: Window | null) => {
    window.dispatchEvent(new MessageEvent('message', {data: {type, data}, source}));
};

const message = (clientMsgId: string): IPostMessage => ({payloadType: 1, payload: {}, clientMsgId});

describe('createPostConnector', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('takes window messages on a host only from its own frame', () => {
        const frame = makeFrame();
        const stranger = makeFrame();
        const {received, stop} = listen('message-from-host', frame);

        post('message-to-host', message('from-frame'), frame.contentWindow);
        post('message-to-host', message('from-stranger'), stranger.contentWindow);

        expect(received.map(item => item.clientMsgId)).toEqual(['from-frame']);
        stop();
    });

    it('takes window messages without a frame only from the page itself, not from another window', () => {
        const stranger = makeFrame();
        const {received, stop} = listen('message-to-host');

        post('message-from-host', message('native'), null);
        post('message-from-host', message('same-window'), window);
        post('message-from-host', message('from-stranger'), stranger.contentWindow);

        expect(received.map(item => item.clientMsgId)).toEqual(['native', 'same-window']);
        stop();
    });
});
