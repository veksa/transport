import {IMessage} from '../interfaces';

export interface IRestMessage<Payload = object> extends IMessage<Payload> {
    url: string;
    method: string;
    headers?: object;
}
