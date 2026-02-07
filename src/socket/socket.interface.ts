import {IMessage} from '../interfaces';

export type MessagePayload = ArrayBuffer | string;

export interface ISocketMessage<Payload = object> extends IMessage<Payload> {
    payloadType: number;
}
