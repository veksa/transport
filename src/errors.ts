import {TransportErrorCode} from './interfaces';

const errorCodeOf = (error: unknown): unknown => {
    return typeof error === 'object' && error !== null ? (error as {errorCode?: unknown}).errorCode : undefined;
};

/** The request failed because the connection was not there or went away under it. */
export const isClosedConnection = (error: unknown): boolean => {
    return errorCodeOf(error) === TransportErrorCode.ClosedConnection;
};

/** The request got no reply within its timeout while the connection stayed up. */
export const isRequestTimeout = (error: unknown): boolean => {
    return errorCodeOf(error) === TransportErrorCode.RequestTimeout;
};

/** The transport ended the request, not the other side: nothing about the request itself is known. */
export const isTransportError = (error: unknown): boolean => {
    return isClosedConnection(error) || isRequestTimeout(error);
};
