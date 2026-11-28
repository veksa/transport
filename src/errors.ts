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

/**
 * The code of a refusal from the other side (`{errorCode}`), or the transport's own (`ClosedConnection`,
 * `RequestTimeout`). Anything else that reaches a catch is an ordinary exception: no code, `undefined`.
 */
export const getErrorCode = (error: unknown): string | undefined => {
    const errorCode = errorCodeOf(error);

    return typeof errorCode === 'string' && errorCode !== '' ? errorCode : undefined;
};

/**
 * The `description` the other side gave with its refusal, when it gave one: blank text counts as none. The text a
 * transport failure carries is a diagnostic for the log, not something the other side said, so it is `undefined`
 * here too — show the app's own sentence for a dropped connection or a timeout.
 */
export const getErrorDescription = (error: unknown): string | undefined => {
    if (typeof error !== 'object' || error === null || isTransportError(error)) {
        return undefined;
    }

    const {description} = error as {description?: unknown};

    return typeof description === 'string' && description.trim() !== '' ? description : undefined;
};
