export class FileManager {

    public static writeFile(bytes: any, path: string, callback: (...args) => void) {
        const listener = new com.github.triniwiz.async.Async.FileManager.Callback({
            onError(param0: string, param1: java.lang.Exception): void {
                callback(param0, null);
            },
            onComplete(param0: any): void {
                callback(null, param0);
            }
        });
        if (bytes instanceof java.nio.ByteBuffer) {
            com.github.triniwiz.async.Async.FileManager.writeFile(bytes.array(), path, listener);
        } else if (bytes instanceof ArrayBuffer) {
            if ((bytes as any).nativeObject) {
                com.github.triniwiz.async.Async.FileManager.writeFile((bytes as any).nativeObject.array(), path, listener);
            }
        } else {
            com.github.triniwiz.async.Async.FileManager.writeFile(bytes, path, listener);
        }

    }

    public static readFile(path: string, options: Options = {asStream: false}, callback: (...args) => void) {
        const opts = new com.github.triniwiz.async.Async.FileManager.Options();
        opts.asStream = options.asStream;
        com.github.triniwiz.async.Async.FileManager.readFile(path, opts, new com.github.triniwiz.async.Async.FileManager.Callback({
            onError(param0: string, param1: java.lang.Exception): void {
                callback(param0, null);
            },
            onComplete(param0: any): void {
                callback(null, param0);
            }
        }));
    }
}

export interface Options {
    asStream?: boolean;
}
