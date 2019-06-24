import { Headers, HttpError, HttpRequestOptions } from './http-request-common';
import * as types from 'tns-core-modules/utils/types';

export type CancellablePromise = Promise<any> & { cancel: () => void };

declare var com;

export enum HttpResponseEncoding {
    UTF8,
    GBK
}

function parseJSON(source: string): any {
    const src = source.trim();
    if (src.lastIndexOf(')') === src.length - 1) {
        return JSON.parse(
            src.substring(src.indexOf('(') + 1, src.lastIndexOf(')'))
        );
    }

    return JSON.parse(src);
}

const requestCallbacks = new Map();

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
        const request = <CancellablePromise>new Promise<any>((resolve, reject) => {
            try {
                // initialize the options
                const javaOptions = this.buildJavaOptions(options);
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
                        if (result.content instanceof org.json.JSONObject || result.content instanceof org.json.JSONArray) {
                            content = deserialize(result.content);
                        } else {
                            content = result.content;
                        }
                        if (result && result.headers) {
                            const length = result.headers.size();
                            let pair;
                            for (let i = 0; i < length; i++) {
                                pair = result.headers.get(i);
                                addHeader(headers, pair.key, pair.value);
                            }
                        }
                        resolve({
                            url: result.url,
                            content,
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
