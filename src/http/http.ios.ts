import * as types from 'tns-core-modules/utils/types';
import { File, knownFolders, path } from 'tns-core-modules/file-system';
import { FileManager } from '../file/file';
import {
    fileNameFromPath,
    Headers,
    HttpDownloadRequestOptions,
    HttpError,
    HttpRequestOptions,
    isImageUrl,
    SaveImageStorageKey,
    TNSHttpSettings
} from './http-request-common';
import { getString, setString } from 'tns-core-modules/application-settings';

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

const NSURLSessionTaskDelegateImpl = (NSObject as any).extend(
    {
        _lastProgress: {
            lengthComputable: false,
            loaded: 0,
            total: 0
        },
        URLSessionTaskWillPerformHTTPRedirectionNewRequestCompletionHandler: function (
            session: NSURLSession,
            task: NSURLSessionTask,
            response: NSHTTPURLResponse,
            request: NSURLRequest,
            completionHandler: (p1: NSURLRequest) => void
        ) {
            completionHandler(request);
            this._url = response.URL.absoluteString;
        },

        URLSessionDataTaskDidReceiveData: function (
            session: NSURLSession,
            dataTask: NSURLSessionDataTask,
            data: NSData
        ) {
            // const method = this._request.HTTPMethod.toLowerCase();
            if (data) {
                if (this._data) {
                    this._data.appendData(data);
                }

                const lastProgress: any = this._lastProgress || {
                    lengthComputable: false,
                    total: 0
                };
                if (this._data) {
                    lastProgress.loaded = this._data.length;
                }
                if (this._onLoading && !this._loadingSent) {
                    this._onLoading(lastProgress);
                    this._loadingSent = true;
                }
                if (this._onProgress) {
                    this._onProgress(lastProgress);
                }
            }
        },

        URLSessionTaskDidSendBodyDataTotalBytesSentTotalBytesExpectedToSend: function (
            session: NSURLSession,
            task,
            bytesSent,
            totalBytesSent,
            totalBytesExpectedToSend
        ) {
            if (this._onLoading || this._onProgress) {
                this._lastProgress = {
                    lengthComputable: totalBytesExpectedToSend > -1,
                    loaded: totalBytesSent,
                    total: totalBytesExpectedToSend > -1 ? totalBytesExpectedToSend : 0
                };
                if (this._onLoading && !this._loadingSent) {
                    this._onLoading(this._lastProgress);
                    this._loadingSent = true;
                }
                if (this._onProgress) {
                    this._onProgress(this._lastProgress);
                }
            }
        },

        URLSessionDataTaskDidReceiveResponseCompletionHandler: function (
            session: NSURLSession,
            dataTask: NSURLSessionDataTask,
            response,
            completionHandler: (p1: NSURLSessionResponseDisposition) => void
        ) {
            completionHandler(NSURLSessionResponseDisposition.Allow);
            this._statusCode = (response as any).statusCode;
            this._url = response.URL.absoluteString;
            this._response = response;
            if (this._onHeaders) {
                const headers = {};
                if (response && response.allHeaderFields) {
                    const headerFields = response.allHeaderFields;
                    headerFields.enumerateKeysAndObjectsUsingBlock((key, value, stop) => {
                        addHeader(headers, key, value);
                    });
                }
                this._onHeaders({
                    headers,
                    status: this._statusCode
                });
            }
            if (this._onProgress) {
                const lengthComputable =
                    response.expectedContentLength && response.expectedContentLength > -1;
                this._lastProgress = {
                    lengthComputable,
                    loaded: 0,
                    total: lengthComputable ? response.expectedContentLength : 0
                };
                this._onProgress(this._lastProgress);
            }
        },

        URLSessionTaskDidCompleteWithError: function (
            session: NSURLSession,
            task: NSURLSessionTask,
            error: NSError
        ) {
            if (error) {
                if (this._reject) {
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
                        if (
                            contentType &&
                            types.isString(contentType) &&
                            contentType.toLowerCase().indexOf(textTypes[i]) >= 0
                        ) {
                            result = true;
                            break;
                        }
                    }
                    return result;
                };

                const headers = {};
                const response = task ? task.response as NSHTTPURLResponse : null;

                if (response && response.allHeaderFields) {
                    const headerFields = response.allHeaderFields;

                    headerFields.enumerateKeysAndObjectsUsingBlock((key, value, stop) => {
                        addHeader(headers, key, value);
                    });
                }
                const request = this._request as NSURLRequest;
                if (request) {
                    let contentType = request.allHTTPHeaderFields.objectForKey(
                        'Content-Type'
                    );
                    if (!contentType) {
                        contentType = request.allHTTPHeaderFields.objectForKey(
                            'content-type'
                        );
                    }
                    let acceptHeader;

                    if (!contentType) {
                        acceptHeader = request.allHTTPHeaderFields.objectForKey('Accept');
                    } else {
                        acceptHeader = contentType;
                    }

                    let returnType = 'text/plain';
                    if (
                        !types.isNullOrUndefined(acceptHeader) &&
                        types.isString(acceptHeader)
                    ) {
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
                            const a_quality = parseFloat(
                                a.substring(a.indexOf(';q=')).replace(';q=', '')
                            );
                            const b_quality = parseFloat(
                                b.substring(b.indexOf(';q=')).replace(';q=', '')
                            );
                            return b_quality - a_quality;
                        });
                        quality.push(...defaultQuality);
                        quality.push(...customQuality);
                        returnType = quality[0];
                    }

                    let content;
                    let responseText;
                    if (this._data && isTextContentType(returnType)) {
                        responseText = NSDataToString(this._data);
                        content = responseText;
                    } else if (
                        this._data &&
                        types.isString(returnType) &&
                        returnType.indexOf('application/json') > -1
                    ) {
                        // @ts-ignore
                        try {
                            responseText = NSDataToString(this._data);
                            content = JSON.parse(responseText);
                            // content = deserialize(NSJSONSerialization.JSONObjectWithDataOptionsError(this._data, NSJSONReadingOptions.AllowFragments, null));
                        } catch (err) {
                            this._reject({
                                type: HttpError.Error,
                                ios: null,
                                message: err
                            });
                            return;
                        }
                    } else {
                        content = this._data;
                    }
                    if (
                        TNSHttpSettings.saveImage &&
                        TNSHttpSettings.currentlySavedImages &&
                        TNSHttpSettings.currentlySavedImages[this._url]
                    ) {
                        // ensure saved to disk
                        if (TNSHttpSettings.currentlySavedImages[this._url].localPath) {
                            FileManager.writeFile(
                                content,
                                TNSHttpSettings.currentlySavedImages[this._url].localPath,
                                function (error, result) {
                                    if (TNSHttpSettings.debug) {
                                        console.log('http image save:', error ? error : result);
                                    }
                                }
                            );
                        }
                    }

                    if (this._debuggerRequest) {
                        this._debuggerRequest.mimeType = this._response.MIMEType;
                        this._debuggerRequest.data = this._data;
                        const debugResponse = {
                            url: this._url,
                            status: this._statusCode,
                            statusText: NSHTTPURLResponse.localizedStringForStatusCode(
                                this._statusCode
                            ),
                            headers: headers,
                            mimeType: this._response.MIMEType,
                            fromDiskCache: false
                        };
                        this._debuggerRequest.responseReceived(debugResponse);
                        this._debuggerRequest.loadingFinished();
                    }

                    this._resolve({
                        url: this._url,
                        content,
                        responseText,
                        statusCode: this._statusCode,
                        headers: headers
                    });
                }
            }
        }
    },
    {
        protocols: [NSURLSessionTaskDelegate, NSURLSessionDataDelegate]
    }
);
NSURLSessionTaskDelegateImpl.initWithDebuggerRequestResolveRejectCallbackHeadersLoadingListener = function (
    debuggerRequest,
    request,
    resolve,
    reject,
    onProgress,
    onHeaders,
    onLoading
) {
    const delegate = NSURLSessionTaskDelegateImpl.new();
    delegate._request = request;
    delegate._resolve = resolve;
    delegate._reject = reject;
    delegate._onProgress = onProgress;
    delegate._onHeaders = onHeaders;
    delegate._onLoading = onLoading;
    delegate._data = NSMutableData.new();
    delegate._debuggerRequest = debuggerRequest;
    return delegate;
};
/*
const NSURLSessionDownloadDelegateImpl = (NSObject as any).extend({
    _lastProgress: {
        lengthComputable: false,
        loaded: 0,
        total: 0
    },

    URLSessionTaskWillPerformHTTPRedirectionNewRequestCompletionHandler: function (
        session: NSURLSession,
        task: NSURLSessionTask,
        response: NSHTTPURLResponse,
        request: NSURLRequest,
        completionHandler: (p1: NSURLRequest) => void
    ) {
        completionHandler(request);
        this._url = response.URL.absoluteString;
    },
    URLSessionDownloadTaskDidFinishDownloadingToURL(session: NSURLSession, downloadTask: NSURLSessionDownloadTask, location: NSURL): void {
        this._resolve();
    },

    URLSessionDownloadTaskDidResumeAtOffsetExpectedTotalBytes(session: NSURLSession, downloadTask: NSURLSessionDownloadTask, fileOffset: number, expectedTotalBytes: number): void {
        const lastProgress: any = this._lastProgress || {
            lengthComputable: false,
            total: 0
        };
        lastProgress.loaded = fileOffset;
    },

    URLSessionDownloadTaskDidWriteDataTotalBytesWrittenTotalBytesExpectedToWrite(session: NSURLSession, downloadTask: NSURLSessionDownloadTask, bytesWritten: number, totalBytesWritten: number, totalBytesExpectedToWrite: number): void {
        const lastProgress: any = this._lastProgress || {
            lengthComputable: totalBytesExpectedToWrite !== -1,
            total: totalBytesExpectedToWrite !== -1 ? totalBytesExpectedToWrite : 0
        };
        lastProgress.loaded = lastProgress.loaded += bytesWritten;
        if (this._onLoading && !this._loadingSent) {
            this._onLoading(lastProgress);
            this._loadingSent = true;
        }
        if (this._onProgress) {
            this._onProgress(lastProgress);
        }
    },

    URLSessionDidBecomeInvalidWithError(session: NSURLSession, error: NSError): void{
        if (this._reject) {
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
        }
    }
}, {
    protocols: [NSURLSessionDownloadDelegate]
});


NSURLSessionDownloadDelegateImpl.initWithDebuggerRequestResolveRejectCallbackHeadersLoadingListener = function (
    debuggerRequest,
    request,
    resolve,
    reject,
    onProgress,
    onHeaders,
    onLoading
) {
    const delegate = NSURLSessionDownloadDelegateImpl.new();
    delegate._request = request;
    delegate._resolve = resolve;
    delegate._reject = reject;
    delegate._onProgress = onProgress;
    delegate._onHeaders = onHeaders;
    delegate._onLoading = onLoading;
    delegate._debuggerRequest = debuggerRequest;
    return delegate;
};

*/


// class NSURLSessionTaskDelegateImpl extends NSObject
//     implements NSURLSessionTaskDelegate, NSURLSessionDataDelegate {
//     public static ObjCProtocols = [
//         NSURLSessionTaskDelegate,
//         NSURLSessionDataDelegate
//     ];
//     private _onProgress;
//     private _onHeaders;
//     private _onLoading;
//     private _resolve;
//     private _reject;
//     private _statusCode: number = 0;
//     private _url: string = '';
//     private _request;
//     private _loadingSent: boolean;
//     private _debuggerRequest;
//     private _response;

//     public static initWithDebuggerRequestResolveRejectCallbackHeadersLoadingListener(
//         debuggerRequest,
//         request,
//         resolve,
//         reject,
//         onProgress,
//         onHeaders,
//         onLoading
//     ) {
//         const delegate = NSURLSessionTaskDelegateImpl.new() as NSURLSessionTaskDelegateImpl;
//         delegate._request = request;
//         delegate._resolve = resolve;
//         delegate._reject = reject;
//         delegate._onProgress = onProgress;
//         delegate._onHeaders = onHeaders;
//         delegate._onLoading = onLoading;
//         delegate._data = NSMutableData.new();
//         delegate._debuggerRequest = debuggerRequest;
//         return delegate;
//     }

//     private _data: NSMutableData;

//     private _lastProgress = {
//         lengthComputable: false,
//         loaded: 0,
//         total: 0
//     };

//     public URLSessionTaskWillPerformHTTPRedirectionNewRequestCompletionHandler(
//         session: NSURLSession,
//         task: NSURLSessionTask,
//         response: NSHTTPURLResponse,
//         request: NSURLRequest,
//         completionHandler: (p1: NSURLRequest) => void
//     ): void {
//         completionHandler(request);
//         this._url = response.URL.absoluteString;
//     }

//     public URLSessionDataTaskDidReceiveData(
//         session: NSURLSession,
//         dataTask: NSURLSessionDataTask,
//         data: NSData
//     ) {
//         // const method = this._request.HTTPMethod.toLowerCase();
//         if (data) {
//           if (this._data) {
//             this._data.appendData(data);
//           }

//             const lastProgress: any = this._lastProgress || {
//                 lengthComputable: false,
//                 total: 0
//             };
//             if (this._data) {
//               lastProgress.loaded = this._data.length;
//             }
//             if (this._onLoading && !this._loadingSent) {
//                 this._onLoading(lastProgress);
//                 this._loadingSent = true;
//             }
//             if (this._onProgress) {
//                 this._onProgress(lastProgress);
//             }
//         }
//     }

//     public URLSessionTaskDidSendBodyDataTotalBytesSentTotalBytesExpectedToSend(
//         session: NSURLSession,
//         task,
//         bytesSent,
//         totalBytesSent,
//         totalBytesExpectedToSend
//     ) {
//         if (this._onLoading || this._onProgress) {
//             this._lastProgress = {
//                 lengthComputable: totalBytesExpectedToSend > -1,
//                 loaded: totalBytesSent,
//                 total: totalBytesExpectedToSend > -1 ? totalBytesExpectedToSend : 0
//             };
//             if (this._onLoading && !this._loadingSent) {
//                 this._onLoading(this._lastProgress);
//                 this._loadingSent = true;
//             }
//             if (this._onProgress) {
//                 this._onProgress(this._lastProgress);
//             }
//         }
//     }

//     public URLSessionDataTaskDidReceiveResponseCompletionHandler(
//         session: NSURLSession,
//         dataTask: NSURLSessionDataTask,
//         response,
//         completionHandler: (p1: NSURLSessionResponseDisposition) => void
//     ) {
//         completionHandler(NSURLSessionResponseDisposition.Allow);
//         this._statusCode = (response as any).statusCode;
//         this._url = response.URL.absoluteString;
//         this._response = response;
//         if (this._onHeaders) {
//             const headers = {};
//             if (response && response.allHeaderFields) {
//                 const headerFields = response.allHeaderFields;
//                 headerFields.enumerateKeysAndObjectsUsingBlock(
//                     (key, value, stop) => {
//                         addHeader(headers, key, value);
//                     }
//                 );
//             }
//             this._onHeaders(
//                 {
//                     headers,
//                     status: this._statusCode
//                 }
//             );
//         }
//         if (this._onProgress) {
//             const lengthComputable =
//                 response.expectedContentLength &&
//                 response.expectedContentLength > -1;
//             this._lastProgress = {
//                 lengthComputable,
//                 loaded: 0,
//                 total: lengthComputable ? response.expectedContentLength : 0
//             };
//             this._onProgress(this._lastProgress);
//         }
//     }

//     public URLSessionTaskDidCompleteWithError(
//         session: NSURLSession,
//         task: NSURLSessionTask,
//         error: NSError
//     ) {
//         if (error) {
//             switch (error.code) {
//                 case NSURLErrorTimedOut:
//                     this._reject({
//                         type: HttpError.Timeout,
//                         ios: error,
//                         message: error.localizedDescription
//                     });
//                     break;
//                 case NSURLErrorCancelled:
//                     this._reject({
//                         type: HttpError.Cancelled,
//                         ios: error,
//                         message: error.localizedDescription
//                     });
//                     break;
//                 default:
//                     this._reject({
//                         type: HttpError.Error,
//                         ios: error,
//                         message: error.localizedDescription
//                     });
//                     break;
//             }
//         } else {

//             const textTypes: string[] = [
//                 'text/plain',
//                 'application/xml',
//                 'application/rss+xml',
//                 'text/html',
//                 'text/xml'
//             ];

//             const isTextContentType = (contentType: string): boolean => {
//                 let result = false;
//                 for (let i = 0; i < textTypes.length; i++) {
//                     if (types.isString(contentType) && contentType.toLowerCase().indexOf(textTypes[i]) >= 0) {
//                         result = true;
//                         break;
//                     }
//                 }
//                 return result;
//             };

//             const headers = {};
//             const response = task.response as NSHTTPURLResponse;

//             if (response && response.allHeaderFields) {
//                 const headerFields = response.allHeaderFields;

//                 headerFields.enumerateKeysAndObjectsUsingBlock(
//                     (key, value, stop) => {
//                         addHeader(headers, key, value);
//                     }
//                 );
//             }
//             const request = this._request as NSURLRequest;
//             let contentType = request.allHTTPHeaderFields.objectForKey('Content-Type');
//             if (!contentType) {
//                 contentType = request.allHTTPHeaderFields.objectForKey('content-type');
//             }
//             let acceptHeader;

//             if (!contentType) {
//                 acceptHeader = request.allHTTPHeaderFields.objectForKey('Accept');
//             } else {
//                 acceptHeader = contentType;
//             }

//             let returnType = 'text/plain';
//             if (!types.isNullOrUndefined(acceptHeader) && types.isString(acceptHeader)) {
//                 let acceptValues = acceptHeader.split(',');
//                 let quality = [];
//                 let defaultQuality = [];
//                 let customQuality = [];
//                 for (let value of acceptValues) {
//                     if (value.indexOf(';q=') > -1) {
//                         customQuality.push(value);
//                     } else {
//                         defaultQuality.push(value);
//                     }
//                 }
//                 customQuality = customQuality.sort((a, b) => {
//                     const a_quality = parseFloat(a.substring(a.indexOf(';q=')).replace(';q=', ''));
//                     const b_quality = parseFloat(b.substring(b.indexOf(';q=')).replace(';q=', ''));
//                     return (b_quality - a_quality);
//                 });
//                 quality.push(...defaultQuality);
//                 quality.push(...customQuality);
//                 returnType = quality[0];
//             }

//             let content;
//             let responseText;
//             if (this._data && isTextContentType(returnType)) {
//                 responseText = NSDataToString(this._data);
//                 content = responseText;
//             } else if (this._data && types.isString(returnType) && returnType.indexOf('application/json') > -1) {
//                 // @ts-ignore
//                 try {
//                     responseText = NSDataToString(this._data);
//                     content = JSON.parse(responseText);
//                     // content = deserialize(NSJSONSerialization.JSONObjectWithDataOptionsError(this._data, NSJSONReadingOptions.AllowFragments, null));
//                 } catch (err) {
//                     this._reject({
//                         type: HttpError.Error,
//                         ios: null,
//                         message: err
//                     });
//                     return;
//                 }
//             } else {
//                 content = this._data;
//             }
//             if (TNSHttpSettings.saveImage && TNSHttpSettings.currentlySavedImages && TNSHttpSettings.currentlySavedImages[this._url]) {
//               // ensure saved to disk
//               if (TNSHttpSettings.currentlySavedImages[this._url].localPath) {
//                 FileManager.writeFile(content, TNSHttpSettings.currentlySavedImages[this._url].localPath, function(error, result) {
//                   if (TNSHttpSettings.debug) {
//                     console.log('http image save:', error ? error : result);
//                   }
//                 });
//               }
//             }

//             if (this._debuggerRequest) {
//                 this._debuggerRequest.mimeType = this._response.MIMEType;
//                 this._debuggerRequest.data = this._data;
//                 const debugResponse = {
//                     url: this._url,
//                     status: this._statusCode,
//                     statusText: NSHTTPURLResponse.localizedStringForStatusCode(this._statusCode),
//                     headers: headers,
//                     mimeType: this._response.MIMEType,
//                     fromDiskCache: false
//                 };
//                 this._debuggerRequest.responseReceived(debugResponse);
//                 this._debuggerRequest.loadingFinished();
//             }

//             this._resolve({
//                 url: this._url,
//                 content,
//                 responseText,
//                 statusCode: this._statusCode,
//                 headers: headers
//             });
//         }
//     }
// }

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
    private _session: NSURLSession;
    private _sessionDelegate: any; //NSURLSessionTaskDelegateImpl;

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
                const makeRemoteRequest = () => {
                    const sessionConfig = NSURLSessionConfiguration.defaultSessionConfiguration;
                    sessionConfig.timeoutIntervalForRequest = options.timeout || 60;
                    sessionConfig.timeoutIntervalForResource = options.timeout || 60;
                    const manager = AFURLSessionManager.alloc()
                        .initWithSessionConfiguration(sessionConfig);

                    // make remote request
                    const urlRequest = NSMutableURLRequest.requestWithURL(
                        NSURL.URLWithString(options.url)
                    );

                    urlRequest.HTTPMethod = types.isDefined(options.method)
                        ? options.method
                        : GET;

                    urlRequest.setValueForHTTPHeaderField(USER_AGENT, USER_AGENT_HEADER);

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
                        types.isString(options.content)
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

                    /*  this._sessionDelegate = NSURLSessionTaskDelegateImpl.initWithDebuggerRequestResolveRejectCallbackHeadersLoadingListener(
                          debugRequest,
                          urlRequest,
                          resolve,
                          reject,
                          options.onProgress,
                          options.onHeaders,
                          options.onLoading
                      );
                      this._session = NSURLSession.sessionWithConfigurationDelegateDelegateQueue(
                          sessionConfig,
                          this._sessionDelegate,
                          null
                      );*/
                    let lastProgress = {
                        lengthComputable: false,
                        total: 0,
                        loaded: 0
                    };
                    let loadingSent = false;
                    let headersSent = false;

                    const handleProgress = (progress) => {
                        lastProgress.loaded = Math.floor(
                            Math.round(progress.fractionCompleted * 100)
                        );

                        if (options.onHeaders && !headersSent) {
                            const headers = {};
                            if (task.response && (task as any).response.allHeaderFields) {
                                const headerFields = (task as any).response.allHeaderFields;
                                headerFields.enumerateKeysAndObjectsUsingBlock((key, value, stop) => {
                                    addHeader(headers, key, value);
                                });
                            }
                            options.onHeaders({
                                headers,
                                status: (task.response as any).statusCode
                            });
                            headersSent = true;
                        }

                        if (options.onLoading && !loadingSent) {
                            options.onLoading();
                            loadingSent = true;
                        }
                        if (options.onProgress) {
                            options.onProgress(lastProgress);
                        }
                    };
                    const task = manager.dataTaskWithRequestUploadProgressDownloadProgressCompletionHandler(urlRequest,
                        (progress) => {
                            handleProgress(progress);
                        },
                        (progress) => {
                            handleProgress(progress);
                        },
                        (response, data, error) => {
                            const url = response.URL.absoluteString;
                            if (error) {
                                if (reject) {
                                    switch (error.code) {
                                        case NSURLErrorTimedOut:
                                            reject({
                                                type: HttpError.Timeout,
                                                ios: error,
                                                message: error.localizedDescription
                                            });
                                            break;
                                        case NSURLErrorCancelled:
                                            reject({
                                                type: HttpError.Cancelled,
                                                ios: error,
                                                message: error.localizedDescription
                                            });
                                            break;
                                        default:
                                            reject({
                                                type: HttpError.Error,
                                                ios: error,
                                                message: error.localizedDescription
                                            });
                                            break;
                                    }
                                }
                            } else {
                                handleProgress(task.progress);
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
                                        if (
                                            contentType &&
                                            types.isString(contentType) &&
                                            contentType.toLowerCase().indexOf(textTypes[i]) >= 0
                                        ) {
                                            result = true;
                                            break;
                                        }
                                    }
                                    return result;
                                };
                                const headers = {};
                                const response = task ? task.response as NSHTTPURLResponse : null;
                                if (response && response.allHeaderFields) {
                                    const headerFields = response.allHeaderFields;

                                    headerFields.enumerateKeysAndObjectsUsingBlock((key, value, stop) => {
                                        addHeader(headers, key, value);
                                    });
                                }
                                const request = urlRequest as NSURLRequest;
                                if (request) {
                                    let contentType = request.allHTTPHeaderFields.objectForKey(
                                        'Content-Type'
                                    );
                                    if (!contentType) {
                                        contentType = request.allHTTPHeaderFields.objectForKey(
                                            'content-type'
                                        );
                                    }
                                    let acceptHeader;

                                    if (!contentType) {
                                        acceptHeader = request.allHTTPHeaderFields.objectForKey('Accept');
                                    } else {
                                        acceptHeader = contentType;
                                    }

                                    let returnType = 'text/plain';
                                    if (
                                        !types.isNullOrUndefined(acceptHeader) &&
                                        types.isString(acceptHeader)
                                    ) {
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
                                            const a_quality = parseFloat(
                                                a.substring(a.indexOf(';q=')).replace(';q=', '')
                                            );
                                            const b_quality = parseFloat(
                                                b.substring(b.indexOf(';q=')).replace(';q=', '')
                                            );
                                            return b_quality - a_quality;
                                        });
                                        quality.push(...defaultQuality);
                                        quality.push(...customQuality);
                                        returnType = quality[0];
                                    }

                                    let content;
                                    let responseText;
                                    console.log(headers);
                                    console.log(returnType, data instanceof NSDictionary, isTextContentType(returnType), returnType.indexOf('application/json') > -1);
                                    if (data && data instanceof NSData && isTextContentType(returnType)) {
                                        responseText = NSDataToString(data);
                                        content = responseText;
                                    } else if (
                                        data &&
                                        data instanceof NSData &&
                                        types.isString(returnType) &&
                                        returnType.indexOf('application/json') > -1
                                    ) {
                                        // @ts-ignore
                                        try {
                                            responseText = NSDataToString(data);
                                            content = JSON.parse(responseText);
                                            // content = deserialize(NSJSONSerialization.JSONObjectWithDataOptionsError(this._data, NSJSONReadingOptions.AllowFragments, null));
                                        } catch (err) {
                                            reject({
                                                type: HttpError.Error,
                                                ios: null,
                                                message: err
                                            });
                                            return;
                                        }
                                    } else if (data && data instanceof NSDictionary && isTextContentType(returnType)) {
                                        responseText = JSON.stringify(deserialize(data));
                                        content = responseText;
                                    } else if (data && data instanceof NSDictionary && types.isString(returnType) &&
                                        returnType.indexOf('application/json') > -1) {
                                        content = deserialize(data);
                                        responseText = JSON.stringify(content);
                                    } else {
                                        content = data;
                                    }
                                    if (
                                        TNSHttpSettings.saveImage &&
                                        TNSHttpSettings.currentlySavedImages &&
                                        TNSHttpSettings.currentlySavedImages[url]
                                    ) {
                                        // ensure saved to disk
                                        if (TNSHttpSettings.currentlySavedImages[url].localPath) {
                                            FileManager.writeFile(
                                                content,
                                                TNSHttpSettings.currentlySavedImages[url].localPath,
                                                function (error, result) {
                                                    if (TNSHttpSettings.debug) {
                                                        console.log('http image save:', error ? error : result);
                                                    }
                                                }
                                            );
                                        }
                                    }

                                    if (debugRequest) {
                                        debugRequest.mimeType = response.MIMEType;
                                        debugRequest.data = data;
                                        const debugResponse = {
                                            url: url,
                                            status: response.statusCode,
                                            statusText: NSHTTPURLResponse.localizedStringForStatusCode(
                                                response.statusCode
                                            ),
                                            headers: headers,
                                            mimeType: response.MIMEType,
                                            fromDiskCache: false
                                        };
                                        debugRequest.responseReceived(debugResponse);
                                        debugRequest.loadingFinished();
                                    }

                                    resolve({
                                        url: url,
                                        content,
                                        responseText,
                                        statusCode: response.statusCode,
                                        headers: headers
                                    });
                                }
                            }

                        });
                    Http._tasks.set(id, task);
                    if (options.url && debugRequest) {
                        const request = {
                            url: options.url,
                            method: urlRequest.HTTPMethod,
                            headers: options.headers
                        };
                        debugRequest.requestWillBeSent(request);
                    }
                    task.resume();
                };

                let domainDebugger;
                let debugRequest;
                if (TNSHttpSettings.debug) {
                    domainDebugger = require('tns-core-modules/debugger');
                    const network = domainDebugger.getNetwork();
                    debugRequest = network && network.create();
                }

                if (TNSHttpSettings.saveImage && isImageUrl(options.url)) {
                    // handle saved images to disk
                    if (!TNSHttpSettings.currentlySavedImages) {
                        const stored = getString(SaveImageStorageKey);
                        if (stored) {
                            try {
                                TNSHttpSettings.currentlySavedImages = JSON.parse(stored);
                            } catch (err) {
                                TNSHttpSettings.currentlySavedImages = {};
                            }
                        } else {
                            TNSHttpSettings.currentlySavedImages = {};
                        }
                    }

                    const imageSetting =
                        TNSHttpSettings.currentlySavedImages[options.url];
                    const requests = imageSetting ? imageSetting.requests : 0;
                    let localPath: string;
                    if (
                        imageSetting &&
                        imageSetting.localPath &&
                        File.exists(imageSetting.localPath)
                    ) {
                        // previously saved to disk
                        resolve({
                            url: options.url,
                            responseText: '',
                            statusCode: 200,
                            content: File.fromPath(imageSetting.localPath).readSync(function (
                                err
                            ) {
                                if (TNSHttpSettings.debug) {
                                    console.log('http image load error:', err);
                                }
                            }),
                            headers: {
                                'Content-Type': 'arraybuffer'
                            }
                        });
                    } else if (requests >= TNSHttpSettings.saveImage.numberOfRequests) {
                        // setup to write to disk when response finishes
                        let filename = fileNameFromPath(options.url);
                        if (filename.indexOf('?')) {
                            // strip any params if were any
                            filename = filename.split('?')[0];
                        }
                        localPath = path.join(knownFolders.documents().path, filename);
                        makeRemoteRequest();
                    }

                    // save settings
                    TNSHttpSettings.currentlySavedImages[options.url] = {
                        ...(imageSetting || {}),
                        date: Date.now(),
                        requests: requests + 1,
                        localPath
                    };
                    setString(
                        SaveImageStorageKey,
                        JSON.stringify(TNSHttpSettings.currentlySavedImages)
                    );
                } else {
                    makeRemoteRequest();
                }
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

    public static getFile(options: HttpDownloadRequestOptions): CancellablePromise {
        let id = NSUUID.UUID().UUIDString;
        const request = <CancellablePromise>new Promise<any>((resolve, reject) => {
            if (!options.url) {
                reject(new Error('Request url was empty.'));
                return;
            }

            try {
                const makeRemoteRequest = () => {
                    const sessionConfig = NSURLSessionConfiguration.defaultSessionConfiguration;
                    sessionConfig.timeoutIntervalForRequest = options.timeout || 60;
                    sessionConfig.timeoutIntervalForResource = options.timeout || 60;
                    const manager = AFHTTPSessionManager.alloc()
                        .initWithSessionConfiguration(sessionConfig);

                    // make remote request
                    const urlRequest = NSMutableURLRequest.requestWithURL(
                        NSURL.URLWithString(options.url)
                    );

                    urlRequest.HTTPMethod = GET;

                    urlRequest.setValueForHTTPHeaderField(USER_AGENT, USER_AGENT_HEADER);

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

                    /* const sessionDelegate = NSURLSessionTaskDelegateImpl.initWithDebuggerRequestResolveRejectCallbackHeadersLoadingListener(
                         debugRequest,
                         urlRequest,
                         resolve,
                         reject,
                         options.onProgress,
                         options.onHeaders,
                         options.onLoading
                     );
                     this._session = NSURLSession.sessionWithConfigurationDelegateDelegateQueue(
                         sessionConfig,
                         this._sessionDelegate,
                         null
                     );


                     const task = this._session.dataTaskWithRequest(urlRequest);*/
                    const filePath = (options.filePath || path.join(knownFolders.temp().path, NSUUID.UUID().UUIDString)).replace('file://', '');
                    const task = manager.downloadTaskWithRequestProgressDestinationCompletionHandler(urlRequest,
                        (progress) => {
                            if (options.onProgress) {
                                options.onProgress({
                                    lengthComputable: progress.totalUnitCount > -1,
                                    loaded: task.countOfBytesReceived,
                                    total: progress.totalUnitCount
                                });
                            }
                        },
                        (targetPath, response) => {
                            return NSURL.fileURLWithPath(filePath);
                        },
                        (response, filePath, error) => {
                            if (error) {
                                reject(error.localizedDescription);
                            } else {
                                resolve(filePath);
                            }
                        });
                    Http._tasks.set(id, task);
                    if (options.url && debugRequest) {
                        const request = {
                            url: options.url,
                            method: urlRequest.HTTPMethod,
                            headers: options.headers
                        };
                        debugRequest.requestWillBeSent(request);
                    }
                    task.resume();
                };

                let domainDebugger;
                let debugRequest;
                if (TNSHttpSettings.debug) {
                    domainDebugger = require('tns-core-modules/debugger');
                    const network = domainDebugger.getNetwork();
                    debugRequest = network && network.create();
                }

                makeRemoteRequest();
            } catch (ex) {
                console.log('aaa', ex);
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
