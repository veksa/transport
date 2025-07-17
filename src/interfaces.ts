import {Observable} from 'rxjs';
import {ILogger} from '@veksa/logger';

export enum TransportState {
    Connected = 'Connected',
    Disconnected = 'Disconnected',
    Connecting = 'Connecting',
}

export interface IMessage<Payload = object> {
    payload: Payload;
    clientMsgId: string;
}

export interface ITransportCodec<Message extends IMessage> {
    encode: (message: Message) => ArrayBuffer | string | undefined;
    decode: (buffer: ArrayBuffer | string) => Message | undefined;
}

export interface ITransportApi<Type extends string, InputMessage extends IMessage, OutputMessage extends IMessage, EventMessage extends IMessage> {
    type: Type;
    event$?: Observable<EventMessage>;
    send: (message: InputMessage) => Promise<OutputMessage['payload']>;
}

export interface ITransportAdapter<InputMessage extends IMessage, OutputMessage extends IMessage, EventMessage extends IMessage> {
    data$: Observable<OutputMessage>;
    event$?: Observable<EventMessage>;
    state$: Observable<TransportState>;
    send: (message: InputMessage) => void;
    add: (clientMsgId: string) => void;
    drop: (clientMsgId: string) => void;
    connect: () => void;
    disconnect: () => void;
}

export interface ITransportAdapterMeta {
    completed?: boolean;
}

export interface ITransport<Type extends string, InputMessage extends IMessage, OutputMessage extends IMessage, EventMessage extends IMessage> {
    state$: Observable<TransportState>;
    connect: VoidFunction;
    disconnect: VoidFunction;
    api: ITransportApi<Type, InputMessage, OutputMessage, EventMessage>;
    getLogs: ILogger<IMessage>['getLogs'];
}
