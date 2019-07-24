const background_queue = dispatch_get_global_queue(qos_class_t.QOS_CLASS_DEFAULT, 0);

export class FileManager {

    public static writeFile(bytes: any, path: string, callback: (...args) => void) {
        dispatch_async(background_queue, () => {
            try {
                if (bytes instanceof NSData) {
                    bytes.writeToFileAtomically(path, true);
                } else if (bytes instanceof ArrayBuffer) {
                    NSData.dataWithData(bytes as any).writeToFileAtomically(path, true);
                }
                callback(null, path);
            } catch (e) {
                callback(e, null);
            }
        });
    }

    public static readFile(path: string, options: Options = {asStream: false}, callback: (...args) => void) {
        dispatch_async(background_queue, () => {
            try {
                const data = NSData.dataWithContentsOfFile(path);
                callback(null, data);
            } catch (e) {
                callback(e, null);
            }
        });
    }

    public static deleteFile(path: string, options: Options = {asStream: false}, callback: (...args) => void) {
      dispatch_async(background_queue, () => {
          try {
              NSFileManager.defaultManager.removeItemAtPathError(path);
              callback(null, true);
          } catch (e) {
              callback(e, false);
          }
      });
    }
}

export interface Options {
    asStream?: boolean;
}
