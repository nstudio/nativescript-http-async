import { Headers, HttpError, HttpRequestOptions } from './http-request-common';
import * as types from 'tns-core-modules/utils/types';
import { NetworkAgent } from 'tns-core-modules/debugger';

export type CancellablePromise = Promise<any> & { cancel: () => void };

declare var com;

export enum HttpResponseEncoding {
    UTF8,
    GBK
}

const statuses = {
    100: 'Continue',
    101: 'Switching Protocols',
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    203: 'Non - Authoritative Information',
    204: 'No Content',
    205: 'Reset Content',
    206: 'Partial Content',
    300: 'Multiple Choices',
    301: 'Moved Permanently',
    302: 'Found',
    303: 'See Other',
    304: 'Not Modified',
    305: 'Use Proxy',
    307: 'Temporary Redirect',
    400: 'Bad Request',
    401: 'Unauthorized',
    402: 'Payment Required',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    406: 'Not Acceptable',
    407: 'Proxy Authentication Required',
    408: 'Request Timeout',
    409: 'Conflict',
    410: 'Gone',
    411: 'Length Required',
    412: 'Precondition Failed',
    413: 'Request Entity Too Large',
    414: 'Request - URI Too Long',
    415: 'Unsupported Media Type',
    416: 'Requested Range Not Satisfiable',
    417: 'Expectation Failed',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
    505: 'HTTP Version Not Supported'
};

function parseJSON(source: string): any {
    const src = source.trim();
    if (src.lastIndexOf(')') === src.length - 1) {
        return JSON.parse(
            src.substring(src.indexOf('(') + 1, src.lastIndexOf(')'))
        );
    }

    return JSON.parse(src);
}

const textTypes: string[] = [
    'text/plain',
    'application/xml',
    'application/rss+xml',
    'text/html',
    'text/xml'
];

const isTextContentType = (contentType: string): boolean => {
    let result = false;
    for (let i = 0; i < textTypes.length; i++) {
        if (contentType.toLowerCase().indexOf(textTypes[i]) >= 0) {
            result = true;
            break;
        }
    }
    return result;
};

const requestCallbacks = new Map();
let requestIdCounter = 0;

export class Http {
    constructor() {
    }

    buildJavaOptions(options: HttpRequestOptions) {
        if (typeof options.url !== 'string') {
            throw new Error('Http request must provide a valid url.');
        }

        let javaOptions = new com.github.triniwiz.async.Async.Http.RequestOptions();

        javaOptions.url = options.url;

        let method;
        if (typeof options.method === 'string') {
            javaOptions.method = options.method;
            method = options.method.toLowerCase();
        }
        if ((method && method === 'post') || method === 'put') {
            if (
                typeof options.content === 'string'
            ) {
                javaOptions.content = new java.lang.String(options.content);
            } else if (options.content instanceof FormData) {
                javaOptions.content = new java.lang.String(options.content.toString());
            } else if (typeof options.content === 'object') {
                javaOptions.content = serialize(options.content);
            }
        }
        if (typeof options.timeout === 'number') {
            javaOptions.timeout = options.timeout;
        }

        if (options.headers) {
            const arrayList = new java.util.ArrayList<any>();
            const pair = com.github.triniwiz.async.Async.Http.KeyValuePair;

            if (options.headers instanceof Map) {
                options.headers.forEach((value, key) => {
                    arrayList.add(new pair(key, value + ''));
                });
            } else {
                for (let key in options.headers) {
                    arrayList.add(new pair(key, options.headers[key] + ''));
                }
            }

            javaOptions.headers = arrayList;
        }
        return javaOptions;
    }

    request(options: HttpRequestOptions): CancellablePromise {
        const headers: Headers = {};
        let statusCode = 0;
        let id;
        const counter = requestIdCounter;
        const request = <CancellablePromise>new Promise<any>((resolve, reject) => {
            try {

                // initialize the options
                const javaOptions = this.buildJavaOptions(options);

                // @ts-ignore
                if (global.__inspector && global.__inspector.isConnected) {
                    NetworkAgent.requestWillBeSent(requestIdCounter, options);
                }

                const callback = new com.github.triniwiz.async.Async.Http.Callback({
                    onCancel(param: any): void {
                        reject({
                            type: HttpError.Cancelled,
                            result: param
                        });
                        requestCallbacks.delete(id);
                    },
                    onComplete(result: any): void {
                        let content;
                        let responseText;
                        let isString = false;
                        if (result.content instanceof org.json.JSONObject || result.content instanceof org.json.JSONArray) {
                            content = deserialize(result.content);
                            try {
                                responseText = JSON.stringify(content);
                            } catch (err) {
                                this._reject({
                                    type: HttpError.Error,
                                    ios: null,
                                    message: err
                                });
                                return;
                            }
                            isString = true;
                        } else {
                            content = result.content;
                            if (content instanceof java.lang.String || typeof content === 'string') {
                                try {
                                    responseText = JSON.stringify(content);
                                } catch (err) {
                                    this._reject({
                                        type: HttpError.Error,
                                        ios: null,
                                        message: err
                                    });
                                    return;
                                }
                            }
                        }
                        if (result && result.headers) {
                            const length = result.headers.size();
                            let pair;
                            for (let i = 0; i < length; i++) {
                                pair = result.headers.get(i);
                                addHeader(headers, pair.key, pair.value);
                            }
                        }
                        // send response data (for requestId) to network debugger


                        let contentType = headers['Content-Type'];
                        if (contentType == null) {
                            contentType = headers['content-Type'];
                        }
                        let acceptHeader;

                        if (contentType == null) {
                            acceptHeader = headers['Accept'];
                        } else {
                            acceptHeader = contentType;
                        }

                        let returnType = 'text/plain';
                        if (acceptHeader != null) {
                            let acceptValues = acceptHeader.split(',');
                            let quality = [];
                            let defaultQuality = [];
                            let customQuality = [];
                            for (let value of acceptValues) {
                                if (value.indexOf(';q=') > -1) {
                                    customQuality.push(value);
                                } else {
                                    defaultQuality.push(value);
                                }
                            }
                            customQuality = customQuality.sort((a, b) => {
                                const a_quality = parseFloat(a.substring(a.indexOf(';q=')).replace(';q=', ''));
                                const b_quality = parseFloat(b.substring(b.indexOf(';q=')).replace(';q=', ''));
                                return (b_quality - a_quality);
                            });
                            quality.push(...defaultQuality);
                            quality.push(...customQuality);
                            returnType = quality[0];
                        }

                        result['statusCode'] = statusCode;
                        // send response data (for requestId) to network debugger
                        // @ts-ignore
                        if (global.__inspector && global.__inspector.isConnected) {
                            NetworkAgent.responseReceived(counter, {
                                url: result.url,
                                statusCode,
                                headers,
                                responseAsString: isString ? result.content.toString() : null,
                                responseAsImage: null // TODO needs base64 Image
                            }, headers);
                        }

                        if (isTextContentType(returnType) && !responseText) {
                            try {
                                responseText = JSON.stringify(content);
                            } catch (err) {
                                this._reject({
                                    type: HttpError.Error,
                                    ios: null,
                                    message: err
                                });
                                return;
                            }
                        }
                        resolve({
                            url: result.url,
                            content,
                            responseText,
                            statusCode: statusCode,
                            headers: headers
                        });
                        requestCallbacks.delete(id);
                    },
                    onError(param0: string, param1: java.lang.Exception): void {
                        reject({
                            type: HttpError.Error,
                            message: param0
                        });
                        requestCallbacks.delete(id);
                    },
                    onHeaders(jHeaders: any, status: number): void {
                        statusCode = status;
                        const length = jHeaders.size();
                        let pair;
                        for (let i = 0; i < length; i++) {
                            pair = jHeaders.get(i);
                            addHeader(headers, pair.key, pair.value);
                        }
                        if (options.onHeaders) {
                            options.onHeaders(headers, statusCode);
                        }
                        requestCallbacks.delete(id);
                    }, onLoading(): void {
                        options.onLoading();
                        requestCallbacks.delete(id);
                    }, onProgress(lengthComputable: boolean, loaded: number, total: number): void {
                        if (options.onProgress) {
                            options.onProgress({
                                lengthComputable,
                                loaded,
                                total
                            })
                        }
                        requestCallbacks.delete(id);
                    },
                    onTimeout(): void {
                        reject({
                            type: HttpError.Timeout
                        });
                        requestCallbacks.delete(id);
                    }
                });
                id = com.github.triniwiz.async.Async.Http.makeRequest(javaOptions, callback);
                requestCallbacks.set(id, callback);
                requestIdCounter++;
            } catch (ex) {
                reject({
                    type: HttpError.Error,
                    message: ex.message
                });
            }
        });
        request['cancel'] = function () {
            com.github.triniwiz.async.Async.Http.cancelRequest(id);
        };
        return request;
    }

}

function serialize(data: any): any {
    let store;
    switch (typeof data) {
        case 'string':
        case 'boolean':
        case 'number': {
            return data;
        }

        case 'object': {
            if (!data) {
                return null;
            }

            if (data instanceof Date) {
                return data.toJSON();
            }
            if (Array.isArray(data)) {
                store = new org.json.JSONArray();
                data.forEach((item) => store.put(serialize(item)));
                return store;
            }
            store = new org.json.JSONObject();
            Object.keys(data).forEach((key) => store.put(key, serialize(data[key])));
            return store;
        }

        default:
            return null;
    }

}

function deserialize(data): any {
    if (types.isNullOrUndefined(data)) {
        return null;
    }
    if (typeof data !== 'object') {
        return data;
    }

    if (typeof data.getClass === 'function') {
        let store;
        switch (data.getClass().getName()) {
            case 'java.lang.String': {
                return String(data);
            }
            case 'java.lang.Boolean': {
                return String(data) === 'true';
            }
            case 'java.lang.Integer':
            case 'java.lang.Long':
            case 'java.lang.Double':
            case 'java.lang.Short': {
                return Number(data);
            }
            case 'org.json.JSONArray': {
                store = [];
                for (let j = 0; j < data.length(); j++) {
                    store[j] = deserialize(data.get(j));
                }
                break;
            }
            case 'org.json.JSONObject': {
                store = {};
                let i = data.keys();
                while (i.hasNext()) {
                    let key = i.next();
                    store[key] = deserialize(data.get(key));
                }
                break;
            }
            default:
                store = null;
                break;
        }
        return store;
    } else {
        return data;
    }
}

function decodeResponse(raw: any, encoding?: HttpResponseEncoding): any {
    let charsetName = 'UTF-8';
    if (encoding === HttpResponseEncoding.GBK) {
        charsetName = 'GBK';
    }
    return new java.lang.String(raw.array(), charsetName);
}

export function addHeader(headers: Headers, key: string, value: string): void {
    if (!headers[key]) {
        headers[key] = value;
    } else if (Array.isArray(headers[key])) {
        (<string[]>headers[key]).push(value);
    } else {
        const values: string[] = [<string>headers[key]];
        values.push(value);
        headers[key] = values;
    }
}
