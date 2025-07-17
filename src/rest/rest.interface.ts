import {IMessage} from '../interfaces';

export interface IRestMessage extends IMessage {
    url: string;
    method: string;
    headers?: object;
}
