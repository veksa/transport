import {createMessageAdapter} from "./createMessageAdapter";
import {ITransportAdapter} from "../interfaces";
import {ILogger} from "@veksa/logger";

interface IHostAdapterParams {
    frame?: HTMLIFrameElement;
    prefix: string;
    prefixColor?: string;
    getPayloadName: (payloadType: number) => string;
    logger: ILogger;
}

export const createHostAdapter = (params: IHostAdapterParams): ITransportAdapter => {
    const {frame, prefix, prefixColor, getPayloadName, logger} = params;

    return createMessageAdapter({
        type: 'message-from-host',
        frame, prefix, prefixColor, getPayloadName,
        logger
    });
};
