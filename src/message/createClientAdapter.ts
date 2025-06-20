import {ITransportAdapter} from "../interfaces";
import {createMessageAdapter} from "./createMessageAdapter";
import {ILogger} from "@veksa/logger";

interface IClientAdapterParams {
    prefix: string;
    prefixColor?: string;
    getPayloadName: (payloadType: number) => string;
    logger: ILogger;
}

export const createClientAdapter = (params: IClientAdapterParams): ITransportAdapter => {
    const {prefix, prefixColor, getPayloadName, logger} = params;

    return createMessageAdapter({
        type: 'message-to-host',
        prefix, prefixColor, getPayloadName,
        logger,
    });
};
