export class ProgressEvent {
    private _type: string;
    private _lengthComputable: boolean;
    private _loaded: number;
    private _total: number;

    constructor(
        type: string,
        data: { lengthComputable: boolean; loaded: number; total: number } = {
            lengthComputable: false,
            loaded: 0,
            total: 0
        }
    ) {
        this._type = type;
        this._lengthComputable = data.lengthComputable;
        this._loaded = data.loaded;
        this._total = data.total;
    }

    get lengthComputable(): boolean {
        return this._lengthComputable;
    }

    get loaded(): number {
        return this._loaded;
    }

    get total(): number {
        return this._total;
    }

    get type(): string {
        return this._type;
    }
}

export type Headers = { [key: string]: string | string[] } | Map<string, string>;

export enum HttpError {
    Error,
    Timeout,
    Cancelled
}

export interface HttpRequestOptions {
    method: string;
    url: string;
    headers?: Headers;
    content?: any;
    timeout?: number;
    onProgress?: (event: any) => void;
    onHeaders?: (...args) => void;
    onLoading?: () => void;
}

export enum HttpResponseEncoding {
    UTF8,
    GBK
}

export interface HttpResponse {
    statusCode: number;
    content: any;
    headers: Headers;
    url: string;
}

