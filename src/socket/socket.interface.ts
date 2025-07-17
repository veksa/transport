import {IMessage} from '../interfaces';

export type MessagePayload = ArrayBuffer | string;

export interface ISocketMessage extends IMessage {
    payloadType: number;
}
