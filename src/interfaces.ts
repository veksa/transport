import {Observable} from 'rxjs';
import {ILogger} from '@veksa/logger';

export enum TransportState {
    Connected = 'Connected',
    Disconnected = 'Disconnected',
    Connecting = 'Connecting',
}

export interface ITransportCodec {
    encode: (message: IMessage) => string;
    decode: (buffer: string) => IMessage;
}

export interface IMessage<Payload = unknown> {
    payloadType: number;
    payload: Payload;
    clientMsgId: string;
}

export interface ITransportApi<Type extends string, InternalMessage extends IMessage = IMessage> {
    type: Type;
    event$: Observable<IMessage>;
    send: (message: InternalMessage) => Promise<InternalMessage['payload']>;
}

export interface ITransportAdapter {
    add: (clientMsgId: string) => void;
    drop: (clientMsgId: string) => void;
    data$: Observable<IMessage>;
    event$: Observable<IMessage>;
    state$: Observable<TransportState>;
    send: (message: IMessage) => void;
    connect: () => void;
    disconnect: () => void;
}

export interface ITransportAdapterMeta {
    completed?: boolean;
}

export interface ITransport<Type extends string> {
    state$: Observable<TransportState>;
    connect: VoidFunction;
    disconnect: VoidFunction;
    api: ITransportApi<Type>;
    getLogs: ILogger['getLogs'];
}
