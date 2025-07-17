import {IMessage} from '../interfaces';

export interface IPostMessage extends IMessage {
    payloadType: number;
}
