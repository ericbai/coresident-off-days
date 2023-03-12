/**
 * Custom Error subclass that has ability specify http status code
 */
export default class StatusError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}
