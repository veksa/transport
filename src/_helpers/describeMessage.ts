import {IMessage} from '../interfaces';

/**
 * Names a message in a transport error: its payloadType and clientMsgId, never its payload. An error travels to
 * logs, error reports and screens, and a payload may hold credentials, megabytes of binary data, or values
 * `JSON.stringify` cannot write (a BigInt, a cycle), which would replace the transport error with a TypeError.
 */
export const describeMessage = (message: IMessage, clientMsgId: string = message.clientMsgId): string => {
    const payloadType = (message as {payloadType?: unknown}).payloadType;
    const parts = [
        typeof payloadType === 'number' || typeof payloadType === 'string' ? String(payloadType) : undefined,
        clientMsgId ? `(${clientMsgId})` : undefined,
    ].filter(Boolean);

    return parts.length > 0 ? `Message ${parts.join(' ')}` : 'Message';
};
