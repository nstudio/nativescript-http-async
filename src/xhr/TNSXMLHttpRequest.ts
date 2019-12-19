import { CancellablePromise, Http } from '../http/http';
import { HttpError, HttpRequestOptions, ProgressEvent } from '../http/http-request-common';
import { isIOS } from '@nativescript/core/platform';
import * as types from '@nativescript/core/utils/types';

enum XMLHttpRequestResponseType {
    empty = '',
    text = 'text',
    json = 'json',
    document = 'document',
    arraybuffer = 'arraybuffer',
    blob = 'blob'
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

enum Status {
    UNSENT = 0,
    OPENED = 0,
    LOADING = 200,
    DONE = 200
}

export class TNSXMLHttpRequestUpload {
    private _request: TNSXMLHttpRequest;
    private _listeners: Map<string, Array<Function>> = new Map<string,
        Array<Function>>();

    constructor(req) {
        this._request = req;
    }

    public addEventListener(eventName: string, handler: (e) => void) {
        const handlers = this._listeners.get(eventName) || [];
        handlers.push(handler);
        this._listeners.set(eventName, handlers);
    }

    public removeEventListener(eventName: string, toDetach: (e) => void) {
        let handlers = this._listeners.get(eventName) || [];
        handlers = handlers.filter(handler => handler !== toDetach);
        this._listeners.set(eventName, handlers);
    }

    _emitEvent(eventName: string, ...args: Array<any>) {
        const handlers = this._listeners.get(eventName) || [];
        handlers.forEach(handler => {
            handler(...args);
        });
    }
}

export class TNSXMLHttpRequest {
    public UNSENT = 0;
    public OPENED = 1;
    public HEADERS_RECEIVED = 2;
    public LOADING = 3;
    public DONE = 4;
    onprogress: any;
    onload: any;
    onreadystatechange: any;
    onabort: any;
    onerror: any;
    onloadstart: any;
    ontimeout: any;
    onloadend: any;
    timeout: number = 0;
    private _readyState = this.UNSENT;
    private _response: any = '';
    private _responseType: XMLHttpRequestResponseType = null;
    private _responseText: any = null;
    private _status: number;
    private _request: {
        method: string;
        url: string;
        async: boolean;
        username: string | null;
        password: string | null;
    } = null;
    private _http: Http;
    private _currentRequest: CancellablePromise;
    private _lastProgress: {
        lengthComputable: boolean;
        loaded: number;
        total: number;
    } = {lengthComputable: false, loaded: 0, total: 0};

    private _headers: any;
    private _responseURL: string = '';
    private _httpContent: any;
    private _upload: TNSXMLHttpRequestUpload;
    private _listeners: Map<string, Array<Function>> = new Map<string,
        Array<Function>>();
    withCredentials: boolean;

    constructor() {
        this._status = Status.UNSENT;
        this._http = new Http();
        this._upload = new TNSXMLHttpRequestUpload(this);
    }

    get readyState(): number {
        return this._readyState;
    }

    get response() {
        return this._response;
    }

    get responseType(): any {
        return this._responseType;
    }

    get responseText() {
        if (
            this._responseType === XMLHttpRequestResponseType.text ||
            this._responseType === XMLHttpRequestResponseType.json
        ) {
            return this._responseText;
        }
        return null;
    }

    get responseURL() {
        return this._responseURL;
    }

    get status(): number {
        return this._status;
    }

    get statusText(): string {
        if (
            this._readyState === this.UNSENT ||
            this._readyState === this.OPENED
        ) {
            return '';
        }
        return statuses[this.status];
    }

    get upload(): any {
        return this._upload;
    }

    private textTypes: string[] = [
        'text/plain',
        'application/xml',
        'application/rss+xml',
        'text/html',
        'text/xml'
    ];

    get responseXML(): any {
        const header = this.getResponseHeader('Content-Type') || this.getResponseHeader('content-type');
        const contentType = header && header.toLowerCase();
        if (this.isTextContentType(contentType)) {
            if (this._responseType === XMLHttpRequestResponseType.document) {
                return this.responseText;
            }
        }
        return '';
    }

    private isTextContentType(contentType: string): boolean {
        let result = false;
        for (let i = 0; i < this.textTypes.length; i++) {
            if (contentType.toLowerCase().indexOf(this.textTypes[i]) >= 0) {
                result = true;
                break;
            }
        }
        return result;
    }

    private _setResponseType() {
        const header = this.getResponseHeader('Content-Type') || this.getResponseHeader('content-type');
        const contentType = header && header.toLowerCase();
        if (contentType) {
            if (
                contentType.indexOf('application/json') >= 0 ||
                contentType.indexOf('+json') >= 0
            ) {
                this._responseType = XMLHttpRequestResponseType.json;
            } else if (this.isTextContentType(contentType)) {
                if (
                    contentType.indexOf('text/html') ||
                    contentType.indexOf('text/xml')
                ) {
                    this._responseType = XMLHttpRequestResponseType.document;
                }
                this._responseType = XMLHttpRequestResponseType.text;
            }
        } else {
            this._responseType = XMLHttpRequestResponseType.text;
        }
    }

    public getAllResponseHeaders(): string {
        if (this._readyState < 2) {
            return '';
        }

        let result = '';

        if (typeof this._headers === 'object') {
            const keys = Object.keys(this._headers);
            for (let key of keys) {
                result += key + ': ' + this._headers[key] + '\r\n';
            }
        }

        return result.substr(0, result.length - 2);
    }

    public getResponseHeader(header: string): string {
        if (
            typeof header === 'string' &&
            this._readyState > 1 &&
            this._headers
        ) {
            header = header.toLowerCase();
            if (typeof this._headers === 'object') {
                const keys = Object.keys(this._headers);
                for (let key of keys) {
                    const item = key.toLowerCase();
                    if (item === header) {
                        return this._headers[key];
                    }
                }
            }
            return null;
        }

        return null;
    }

    public overrideMimeType(mime: string) {
    }

    set responseType(value: any) {
        if (
            value === XMLHttpRequestResponseType.empty ||
            value in XMLHttpRequestResponseType
        ) {
            this._responseType = value;
        } else {
            throw new Error(`Response type of '${value}' not supported.`);
        }
    }

    private _addToStringOnResponse() {
        // Add toString() method to ease debugging and
        // make Angular2 response.text() method work properly.
        if (types.isNullOrUndefined(this.response)) {
            return;
        }
        if (types.isObject(this.response)) {
            Object.defineProperty(this._response, 'toString', {
                configurable: true,
                enumerable: false,
                writable: true,
                value: () => this.responseText
            });
        }
    }

    open(
        method: string,
        url: string,
        async: boolean = true,
        username: string | null = null,
        password: string | null = null
    ): void {
        this._headers = {};
        this._responseURL = '';
        this._httpContent = null;
        this._request = {
            method,
            url,
            async,
            username,
            password
        };
        this._updateReadyStateChange(this.OPENED);
    }

    setRequestHeader(header: string, value) {
        if (this._readyState !== this.OPENED) {
            throw new Error(
                'Failed to execute \'setRequestHeader\' on \'XMLHttpRequest\': The object\'s state must be OPENED.'
            );
        }
        if (typeof this._headers === 'object') {
            this._headers[header] = value;
        }
    }

    send(body: any = null): void {
        if (this._readyState !== this.OPENED) {
            throw new Error(
                'Failed to execute \'send\' on \'XMLHttpRequest\': The object\'s state must be OPENED'
            );
        }

        if (!this._headers['Accept']) {
            this._headers['Accept'] = '*/*';
        }
        const method = this._request.method.toLowerCase();
        const request: HttpRequestOptions = {
            content: body,
            method: this._request.method,
            url: this._request.url,
            headers: this._headers,
            onLoading: () => {
                if (this.onloadstart) {
                    this.onloadstart();
                }
                let contentLength = -1;
                if (typeof this._headers === 'object') {
                    if (this._headers['Content-Length']) {
                        contentLength = parseInt(this._headers['Content-Length'], 10) || -1;
                    }

                    if (this._headers['content-length']) {
                        contentLength = parseInt(this._headers['content-length'], 10) || -1;
                    }
                }
                const start = new ProgressEvent('loadstart', {
                    lengthComputable: contentLength > -1,
                    loaded: 0,
                    total: contentLength
                });

                if (this._upload && (method === 'post' || method === 'put')) {
                    this._upload._emitEvent('loadstart', start);
                }
                this.emitEvent('loadstart', start);

                this._updateReadyStateChange(this.LOADING);
            },
            onHeaders: event => {
                if (!isNaN(event.status)) {
                    this._status = event.status;
                }
                if (event.headers) {
                    this._headers = event.headers;
                }
                this._updateReadyStateChange(this.HEADERS_RECEIVED);
            }
        };

        // TODO: ideally we could avoid wiring up progress since it's chatty
        // With Angular integrations could determine based on reportProgress flag in options
        // right now for brevity since GET requests are for more frequent than others,
        // just enabling for post and put temporarily
        if (method === 'post' || method === 'put') {
          request.onProgress = (event) => {
              this._lastProgress = {
                ...(this._lastProgress || {}),
                ...event
              };
              if (event.loaded > 0) {
                  const progress = new ProgressEvent('progress', this._lastProgress);
                  if (this._upload && (method === 'post' || method === 'put')) {
                      this._upload._emitEvent('progress', progress);
                  }
                  this.emitEvent('progress', progress);
              }
          };
        }

        if (this.timeout > 0) {
            request['timeout'] = this.timeout;
        }
        this._currentRequest = this._http
            .request(request);

        this._currentRequest.then(res => {
            this._setResponseType();
            this._status = res.statusCode;
            this._httpContent = res.content;
            this._responseURL = res.url;

            if (this.responseType === XMLHttpRequestResponseType.json) {
                if (typeof res.content === 'string') {
                    this._responseText = res.content;
                    try {
                      this._response = JSON.parse(this.responseText);
                    } catch (err) {
                      // this should probably be caught before the promise resolves
                    }
                } else if (typeof res.content === 'object') {
                    this._response = res.content;
                    this._responseText = res.responseText;
                } else {
                    if (isIOS) {
                        if (res.content instanceof NSData) {
                            let code = NSUTF8StringEncoding; // long:4

                            let encodedString = NSString.alloc().initWithDataEncoding(res.content, code);

                            // If UTF8 string encoding fails try with ISO-8859-1
                            if (!encodedString) {
                                code = NSISOLatin1StringEncoding; // long:5
                                encodedString = NSString.alloc().initWithDataEncoding(res.content, code);
                            }

                            this._responseText = encodedString.toString();
                            this._response = JSON.parse(this._responseText);
                        }
                    } else {
                        if (res.content instanceof java.nio.ByteBuffer) {
                            this._responseText = new java.lang.String(res.content.array());
                            this._response = JSON.parse(this._responseText);
                        }
                    }
                }

            } else if (
                this.responseType === XMLHttpRequestResponseType.text
            ) {
                if (typeof res.content === 'string') {
                    this._responseText = res.content;
                } else if (typeof res.content === 'object') {
                    this._responseText = JSON.stringify(res.content); // Stringify or build manually 🧐
                } else {
                    if (isIOS) {
                        if (res.content instanceof NSData) {
                            let code = NSUTF8StringEncoding; // long:4

                            let encodedString = NSString.alloc().initWithDataEncoding(res.content, code);

                            // If UTF8 string encoding fails try with ISO-8859-1
                            if (!encodedString) {
                                code = NSISOLatin1StringEncoding; // long:5
                                encodedString = NSString.alloc().initWithDataEncoding(res.content, code);
                            }

                            this._responseText = this._response = encodedString.toString()
                        }

                    } else {
                        if (res.content instanceof java.nio.ByteBuffer) {
                            this._responseText = this._response = new java.lang.String(res.content.array());
                        }
                    }
                }
                this._response = this._responseText;
            } else if (
                this.responseType === XMLHttpRequestResponseType.document
            ) {
                if (typeof res.content === 'string') {
                    this._responseText = res.content;
                } else {
                    if (isIOS) {
                        if (res.content instanceof NSData) {
                            let code = NSUTF8StringEncoding; // long:4

                            let encodedString = NSString.alloc().initWithDataEncoding(res.content, code);

                            // If UTF8 string encoding fails try with ISO-8859-1
                            if (!encodedString) {
                                code = NSISOLatin1StringEncoding; // long:5
                                encodedString = NSString.alloc().initWithDataEncoding(res.content, code);
                            }

                            this._responseText = this._response = encodedString.toString()
                        }
                    } else {
                        if (res.content instanceof java.nio.ByteBuffer) {
                            this._responseText = this._response = new java.lang.String(res.content.array());
                        }
                    }
                }
            } else if (
                this.responseType === XMLHttpRequestResponseType.arraybuffer
            ) {
                if (isIOS) {
                    this._response = interop.bufferFromData(
                        res.content
                    );
                } else {
                    this._response = (ArrayBuffer as any).from(res.content);
                }
            } else if (
                this.responseType === XMLHttpRequestResponseType.blob
            ) {
                this._response = res.content;
            }


            this._addToStringOnResponse();

            if (this.onload) {
                this.onload();
            }
            const load = new ProgressEvent('load', this._lastProgress);

            if (this._upload && (method === 'post' || method === 'put')) {
                this._upload._emitEvent('load', load);
            }
            this.emitEvent('load', load);

            if (this.onloadend) {
                this.onloadend();
            }

            const loadend = new ProgressEvent('loadend', this._lastProgress);

            if (this._upload && (method === 'post' || method === 'put')) {
                this._upload._emitEvent('loadend', loadend);
            }
            this.emitEvent('loadend', loadend);

            this._updateReadyStateChange(this.DONE);
        })
            .catch((error) => {
                const type: HttpError = error.type;
                const method = this._request.method.toLowerCase();
                switch (type) {
                    case HttpError.Cancelled:
                        if (this.onabort) {
                            this.onabort();
                        }
                        const abort = new ProgressEvent('abort', this._lastProgress);


                        if (this._upload && (method === 'post' || method === 'put')) {
                            this._upload._emitEvent('abort', abort);
                        }
                        this.emitEvent('abort', abort);

                        if (this.onloadend) {
                            this.onloadend();
                        }

                        const _loadend = new ProgressEvent('loadend', this._lastProgress);

                        if (this._upload && (method === 'post' || method === 'put')) {
                            this._upload._emitEvent('loadend', _loadend);
                        }
                        this.emitEvent('loadend', _loadend);

                        if (
                            this._readyState === this.UNSENT ||
                            this._readyState === this.OPENED ||
                            this._readyState === this.DONE
                        ) {
                            this._updateReadyStateChange(this.UNSENT);
                        } else {
                            this._updateReadyStateChange(this.DONE);
                        }
                        this._currentRequest = null;
                        break;
                    case HttpError.Timeout:
                        if (this.ontimeout) {
                            this.ontimeout();
                        }
                        const timeout = new ProgressEvent('timeout', this._lastProgress);

                        if (this._upload && (method === 'post' || method === 'put')) {
                            this._upload._emitEvent('timeout', timeout);
                        }
                        this.emitEvent('timeout', timeout);
                        break;
                    case HttpError.Error:
                        if (this.onerror) {
                            this.onerror(error.message);
                        }

                        const errorEvent = new ProgressEvent('error', this._lastProgress);

                        if (this._upload && (method === 'post' || method === 'put')) {
                            this._upload._emitEvent('error', errorEvent);
                        }
                        this.emitEvent('error', errorEvent);

                        if (this.onloadend) {
                            this.onloadend();
                        }

                        const loadend = new ProgressEvent('loadend', this._lastProgress);

                        if (this._upload && (method === 'post' || method === 'put')) {
                            this._upload._emitEvent('loadend', loadend);
                        }
                        this.emitEvent('loadend', loadend);
                        break;
                }
                this._updateReadyStateChange(this.DONE);
            });
    }

    abort() {
        if (this._currentRequest) {
            this._currentRequest.cancel();
        }
    }

    public addEventListener(eventName: string, handler: (e) => void) {
        const handlers = this._listeners.get(eventName) || [];
        handlers.push(handler);
        this._listeners.set(eventName, handlers);
    }

    public removeEventListener(eventName: string, toDetach: (e) => void) {
        let handlers = this._listeners.get(eventName) || [];
        handlers = handlers.filter(handler => handler !== toDetach);
        this._listeners.set(eventName, handlers);
    }

    private emitEvent(eventName: string, ...args: Array<any>) {
        const handlers = this._listeners.get(eventName) || [];
        handlers.forEach(handler => {
            handler(...args);
        });
    }

    dispatchEvent(event: Event): boolean {
        return false;
    }

    private _updateReadyStateChange(state) {
        this._readyState = state;
        if (this.onreadystatechange) {
            this.onreadystatechange();
        }
    }
}
