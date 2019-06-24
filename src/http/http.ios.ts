import * as types from 'tns-core-modules/utils/types';
import { Headers, HttpError, HttpRequestOptions } from './http-request-common';

export type CancellablePromise = Promise<any> & { cancel: () => void };

export enum HttpResponseEncoding {
    UTF8,
    GBK
}

const currentDevice = UIDevice.currentDevice;
const device =
    currentDevice.userInterfaceIdiom === UIUserInterfaceIdiom.Phone
        ? 'Phone'
        : 'Pad';
const osVersion = currentDevice.systemVersion;

const GET = 'GET';
const USER_AGENT_HEADER = 'User-Agent';
const USER_AGENT = `Mozilla/5.0 (i${device}; CPU OS ${osVersion.replace(
    '.',
    '_'
)} like Mac OS X) AppleWebKit/536.26 (KHTML, like Gecko) Version/${osVersion} Mobile/10A5355d Safari/8536.25`;
const sessionConfig = NSURLSessionConfiguration.defaultSessionConfiguration;

function parseJSON(source: string): any {
    const src = source.trim();
    if (src.lastIndexOf(')') === src.length - 1) {
        return JSON.parse(
            src.substring(src.indexOf('(') + 1, src.lastIndexOf(')'))
        );
    }

    return JSON.parse(src);
}


class NSURLSessionTaskDelegateImpl extends NSObject
    implements NSURLSessionTaskDelegate, NSURLSessionDataDelegate {
    public static ObjCProtocols = [
        NSURLSessionTaskDelegate,
        NSURLSessionDataDelegate
    ];
    private _onProgress;
    private _onHeaders;
    private _onLoading;
    private _resolve;
    private _reject;
    private _statusCode: number = 0;
    private _url: string = '';
    private _request;
    private _loadingSent: boolean;

    public static initWithRequestResolveRejectCallbackHeadersLoadingListener(
        request,
        resolve,
        reject,
        onProgress,
        onHeaders,
        onLoading
    ) {
        const delegate = NSURLSessionTaskDelegateImpl.new() as NSURLSessionTaskDelegateImpl;
        delegate._request = request;
        delegate._resolve = resolve;
        delegate._reject = reject;
        delegate._onProgress = onProgress;
        delegate._onHeaders = onHeaders;
        delegate._onLoading = onLoading;
        delegate._data = NSMutableData.new();
        return delegate;
    }

    private _data: NSMutableData;

    private _lastProgress = {
        lengthComputable: false,
        loaded: 0,
        total: 0
    };

    public URLSessionTaskWillPerformHTTPRedirectionNewRequestCompletionHandler(
        session: NSURLSession,
        task: NSURLSessionTask,
        response: NSHTTPURLResponse,
        request: NSURLRequest,
        completionHandler: (p1: NSURLRequest) => void
    ): void {
        completionHandler(request);
        this._url = response.URL.absoluteString;
    }

    public URLSessionDataTaskDidReceiveData(
        session: NSURLSession,
        dataTask: NSURLSessionDataTask,
        data: NSData
    ) {
        const method = this._request.HTTPMethod.toLowerCase();
        if (method !== 'post' && method !== 'put') {
            if (!this._loadingSent) {
                const lengthComputable = this._lastProgress.lengthComputable;
                this._onLoading({
                    lengthComputable,
                    loaded: this._data.length,
                    total: this._lastProgress.total
                });
                this._loadingSent = true;
            }
            if (this._data) {
                this._data.appendData(data);
            }
            if (this._onProgress) {
                const lengthComputable = this._lastProgress.lengthComputable;
                this._onProgress({
                    lengthComputable,
                    loaded: this._data.length,
                    total: this._lastProgress.total
                });
            }
        }else{
            if(this._data){
                this._data.appendData(data);
            }
        }
    }

    public URLSessionTaskDidSendBodyDataTotalBytesSentTotalBytesExpectedToSend(
        session: NSURLSession,
        task,
        bytesSent,
        totalBytesSent,
        totalBytesExpectedToSend
    ) {
        if (this._onProgress) {
            const method = this._request.HTTPMethod.toLowerCase();
            if (method === 'post' || method === 'put') {
                const lengthComputable = totalBytesExpectedToSend > -1;
                if (!this._loadingSent) {
                    this._onLoading({
                        lengthComputable,
                        loaded: totalBytesSent,
                        total: lengthComputable ? totalBytesExpectedToSend : 0
                    });
                    this._loadingSent = true;
                }
                this._onProgress({
                    lengthComputable,
                    loaded: totalBytesSent,
                    total: lengthComputable ? totalBytesExpectedToSend : 0
                });
                this._lastProgress = {
                    lengthComputable,
                    loaded: totalBytesSent,
                    total: lengthComputable ? totalBytesExpectedToSend : 0
                };
            }
        }
    }

    public URLSessionDataTaskDidReceiveResponseCompletionHandler(
        session: NSURLSession,
        dataTask: NSURLSessionDataTask,
        response,
        completionHandler: (p1: NSURLSessionResponseDisposition) => void
    ) {
        completionHandler(NSURLSessionResponseDisposition.Allow);
        this._statusCode = (response as any).statusCode;
        this._url = response.URL.absoluteString;
        const method = this._request.HTTPMethod.toLowerCase();
        if (method !== 'post' && method !== 'put') {
            if (this._onHeaders) {
                const headers = {};
                if (response && response.allHeaderFields) {
                    const headerFields = response.allHeaderFields;
                    headerFields.enumerateKeysAndObjectsUsingBlock(
                        (key, value, stop) => {
                            addHeader(headers, key, value);
                        }
                    );
                }
                this._onHeaders(
                    {
                        headers,
                        status: this._statusCode
                    }
                );
            }
            if (this._onProgress) {
                const lengthComputable =
                    response.expectedContentLength &&
                    response.expectedContentLength > -1;
                this._onProgress({
                    lengthComputable,
                    loaded: 0,
                    total: lengthComputable ? response.expectedContentLength : 0
                });
                this._lastProgress = {
                    lengthComputable,
                    loaded: 0,
                    total: lengthComputable ? response.expectedContentLength : 0
                };
            }
        }
    }


    public URLSessionTaskDidCompleteWithError(
        session: NSURLSession,
        task: NSURLSessionTask,
        error: NSError
    ) {
        if (error) {
            switch (error.code) {
                case NSURLErrorTimedOut:
                    this._reject({
                        type: HttpError.Timeout,
                        ios: error,
                        message: error.localizedDescription
                    });
                    break;
                case NSURLErrorCancelled:
                    this._reject({
                        type: HttpError.Cancelled,
                        ios: error,
                        message: error.localizedDescription
                    });
                    break;
                default:
                    this._reject({
                        type: HttpError.Error,
                        ios: error,
                        message: error.localizedDescription
                    });
                    break;
            }
        } else {


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

            const headers = {};
            const response = task.response as NSHTTPURLResponse;

            if (response && response.allHeaderFields) {
                const headerFields = response.allHeaderFields;

                headerFields.enumerateKeysAndObjectsUsingBlock(
                    (key, value, stop) => {
                        addHeader(headers, key, value);
                    }
                );
            }
            const request = this._request as NSURLRequest;
            let contentType = request.allHTTPHeaderFields.objectForKey('Content-Type');
            if (contentType == null) {
                contentType = request.allHTTPHeaderFields.objectForKey('content-Type');
            }
            let acceptHeader;

            if (contentType == null) {
                acceptHeader = request.allHTTPHeaderFields.objectForKey('Accept');
            } else {
                acceptHeader = contentType;
            }

            let returnType = 'text/html';
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

            let content;
            if (isTextContentType(returnType)) {
                content = NSDataToString(this._data);
            } else if (returnType.indexOf('application/json') > -1) {
                // @ts-ignore
                content = deserialize(NSJSONSerialization.JSONObjectWithDataOptionsError(this._data, NSJSONReadingOptions.AllowFragments, null));
            } else {
                content = this._data;
            }

            this._resolve({
                url: this._url,
                content,
                statusCode: this._statusCode,
                headers: headers
            });
        }
    }
}

function NSDataToString(data: any, encoding?: HttpResponseEncoding): string {
    let code = NSUTF8StringEncoding; // long:4

    if (encoding === HttpResponseEncoding.GBK) {
        code = CFStringEncodings.kCFStringEncodingGB_18030_2000; // long:1586
    }

    let encodedString = NSString.alloc().initWithDataEncoding(data, code);

    // If UTF8 string encoding fails try with ISO-8859-1
    if (!encodedString) {
        code = NSISOLatin1StringEncoding; // long:5
        encodedString = NSString.alloc().initWithDataEncoding(data, code);
    }

    return encodedString.toString();
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

export class Http {
    static _tasks: Map<string, NSURLSessionDataTask> = new Map();

    constructor() {
    }


    request(options: HttpRequestOptions): CancellablePromise {
        let id = NSUUID.UUID().UUIDString;
        const request = <CancellablePromise>new Promise<any>((resolve, reject) => {
            if (!options.url) {
                reject(new Error('Request url was empty.'));
                return;
            }

            try {
                const urlRequest = NSMutableURLRequest.requestWithURL(
                    NSURL.URLWithString(options.url)
                );

                urlRequest.HTTPMethod = types.isDefined(options.method)
                    ? options.method
                    : GET;

                urlRequest.setValueForHTTPHeaderField(
                    USER_AGENT,
                    USER_AGENT_HEADER
                );

                if (options.headers) {
                    if (options.headers instanceof Map) {
                        options.headers.forEach((value, key) => {
                            urlRequest.setValueForHTTPHeaderField(value, key);
                        });
                    } else {
                        for (let header in options.headers) {
                            urlRequest.setValueForHTTPHeaderField(
                                options.headers[header] + '',
                                header
                            );
                        }
                    }
                }

                if (
                    types.isString(options.content) ||
                    options.content instanceof FormData
                ) {
                    urlRequest.HTTPBody = NSString.stringWithString(
                        options.content.toString()
                    ).dataUsingEncoding(4);
                } else if (types.isObject(options.content)) {
                    urlRequest.HTTPBody = NSString.stringWithString(
                        JSON.stringify(options.content)
                    ).dataUsingEncoding(4);
                }

                if (types.isNumber(options.timeout)) {
                    urlRequest.timeoutInterval = options.timeout / 1000;
                }

                let session = NSURLSession.sessionWithConfigurationDelegateDelegateQueue(
                    sessionConfig,
                    NSURLSessionTaskDelegateImpl.initWithRequestResolveRejectCallbackHeadersLoadingListener(
                        urlRequest,
                        resolve,
                        reject,
                        options.onProgress,
                        options.onHeaders,
                        options.onLoading
                    ),
                    null
                );

                const task = session.dataTaskWithRequest(urlRequest);
                Http._tasks.set(id, task);
                task.resume();
            } catch (ex) {
                reject({
                    type: HttpError.Error,
                    message: ex
                });
            }
        });
        request['cancel'] = function () {
            const task = Http._tasks.get(id);
            if (task) {
                task.cancel();
            }
        };
        return request;
    }
}


function deserialize(nativeData) {
  if (types.isNullOrUndefined(nativeData)) {
    // some native values will already be js null values
    // calling types.getClass below on null/undefined will cause crash
    return null;
  } else {
    switch (types.getClass(nativeData)) {
      case 'NSNull':
        return null;
      case 'NSMutableDictionary':
      case 'NSDictionary':
        let obj = {};
        const length = nativeData.count;
        const keysArray = nativeData.allKeys as NSArray<any>;
        for (let i = 0; i < length; i++) {
          const nativeKey = keysArray.objectAtIndex(i);
          obj[nativeKey] = deserialize(nativeData.objectForKey(nativeKey));
        }
        return obj;
      case 'NSMutableArray':
      case 'NSArray':
        let array = [];
        const len = nativeData.count;
        for (let i = 0; i < len; i++) {
          array[i] = deserialize(nativeData.objectAtIndex(i));
        }
        return array;
      default:
        return nativeData;
    }
  }
}
