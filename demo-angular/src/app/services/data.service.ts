import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { isIOS } from 'tns-core-modules/platform';
import { ObservableArray } from 'tns-core-modules/data/observable-array';
import { from } from 'rxjs';
import { map, mergeMap , concatMap,switchMap} from 'rxjs/internal/operators';
import * as imageSrc from 'tns-core-modules/image-source';
import { TNSXMLHttpRequest, FileManager } from 'nativescript-async';
import * as fs from 'tns-core-modules/file-system';
import { releaseNativeObject } from 'tns-core-modules/utils/utils';
declare var UIImageJPEGRepresentation, NSDataBase64EncodingOptions, android, java;

@Injectable()
export class DataService {
    private currentImageId: number = 0;
    private imagesData: any[] = [];
    private images = [
        {url: 'https://images.unsplash.com/photo-1458724338480-79bc7a8352e4'},
        {url: 'https://images.unsplash.com/photo-1456318019777-ccdc4d5b2396'},
        {url: 'https://images.unsplash.com/photo-1455098934982-64c622c5e066'},
        {url: 'https://images.unsplash.com/photo-1454817481404-7e84c1b73b4a'},
        {url: 'https://images.unsplash.com/photo-1454982523318-4b6396f39d3a'},
        {url: 'https://images.unsplash.com/photo-1456428199391-a3b1cb5e93ab'},
        {url: 'https://images.unsplash.com/photo-1423768164017-3f27c066407f'},
        {url: 'https://images.unsplash.com/photo-1433360405326-e50f909805b3'},
        {url: 'https://images.unsplash.com/photo-1421749810611-438cc492b581'},
        {url: 'https://images.unsplash.com/photo-1437652010333-fbf2cd02a4f8'},
        {url: 'https://images.unsplash.com/photo-1458640904116-093b74971de9'},
        {url: 'https://images.unsplash.com/photo-1422393462206-207b0fbd8d6b'},
        {url: 'https://images.unsplash.com/photo-1454047637795-79e3325dfa0e'},
        {url: 'https://images.unsplash.com/photo-1457369804613-52c61a468e7d'},
        {url: 'https://images.unsplash.com/photo-1440227537815-f4476b789291'},
        {url: 'https://images.unsplash.com/photo-1428189923803-e9801d464d76'}
    ];
    currentLoadedImage: any;
    localhost = isIOS ? 'localhost' : '10.0.2.2';
    randomUsers = new ObservableArray([]);

    constructor(private httpClient: HttpClient) {
    }

    getRandomUsers(count: number = 1, users: number = 10) {
        const requests = [];
        for (let i = 0; i < count; i++) {
            requests.push(`https://randomuser.me/api/?results=${users}`);
        }
        from(requests)
            .pipe(
                mergeMap(url => {
                    return this.httpClient.get(url, {responseType: 'json'}).pipe(
                        map(value => {
                            if (Array.isArray(value)) {
                                return value[0]['results'];
                            } else if (typeof value === 'object') {
                                return value['results'];
                            }
                        })
                    )
                })
            )
            .subscribe(
                value => {
                    this.randomUsers.push(value);
                }, error => {
                    console.log(error);
                },
                () => {
                    console.log('complete');
                }
            );
    }

    handleEvent(e) {
        console.log(
            'handleEvent',
            `${e.type}: ${e.loaded} bytes transferred\n`
        );
    }

    uploadHandleEvent(e) {
        console.log(
            'uploadHandleEvent',
            `${e.type}: ${e.loaded} bytes transferred\n`
        );
    }

    get largeImage() {
        return this.getBase64(
            imageSrc.fromFile(
                fs.path.join(
                    fs.knownFolders.currentApp().path,
                    '/assets/caspar-camille-rubin-220712-unsplash.jpg'
                )
            )
        );
    }

    getBase64(image: imageSrc.ImageSource) {
        let base64ImgToUpload;
        if (isIOS) {
            const imageData = UIImageJPEGRepresentation(image.ios, 0.95);
            base64ImgToUpload = imageData.base64EncodedStringWithOptions(
                NSDataBase64EncodingOptions.Encoding64CharacterLineLength
            );
        } else {
            const bm = image.android;
            const baos = new java.io.ByteArrayOutputStream();
            bm.compress(android.graphics.Bitmap.CompressFormat.JPEG, 60, baos);
            const byteArrayImage = baos.toByteArray();
            base64ImgToUpload = android.util.Base64.encodeToString(
                byteArrayImage,
                android.util.Base64.DEFAULT
            );
        }
        return base64ImgToUpload;
    }

    addListeners(xhr) {
        xhr.addEventListener('loadstart', this.handleEvent);
        xhr.addEventListener('load', this.handleEvent);
        xhr.addEventListener('loadend', this.handleEvent);
        xhr.addEventListener('progress', this.handleEvent);
        xhr.addEventListener('error', this.handleEvent);
        xhr.addEventListener('abort', this.handleEvent);
        xhr.addEventListener('timeout', this.handleEvent);
    }

    addUploadListeners(xhr) {
        xhr.upload.addEventListener('loadstart', this.uploadHandleEvent);
        xhr.upload.addEventListener('load', this.uploadHandleEvent);
        xhr.upload.addEventListener('loadend', this.uploadHandleEvent);
        xhr.upload.addEventListener('progress', this.uploadHandleEvent);
        xhr.upload.addEventListener('error', this.uploadHandleEvent);
        xhr.upload.addEventListener('abort', this.uploadHandleEvent);
        xhr.upload.addEventListener('timeout', this.uploadHandleEvent);
    }

    makeRequest() {
        from(this.images)
            .pipe(
                concatMap((image) => {
                    return this.httpClient.get(image.url, {
                        responseType: 'arraybuffer',
                        headers: {
                            'Content-Type': 'application/octet-stream'
                        }
                    }).pipe(
                        switchMap((value: any) => {
                            return from(
                                new Promise((resolve, reject) => {
                                    const file = fs.File.fromPath(
                                        fs.path.join(fs.knownFolders.temp().path, `${Date.now()}`)
                                    );
                                    FileManager.writeFile(value, file.path, (error, success) => {
                                        if (!error) {
                                            resolve(file.path);
                                        } else {
                                            reject(error);
                                        }
                                        if (isIOS) {
                                            releaseNativeObject(NSData.dataWithData(value));
                                        } else {
                                            releaseNativeObject(value.nativeObject);
                                        }
                                    });
                                })
                            )
                        })
                    )
                })
            ).subscribe(value => {
            this.imagesData.push(value);
            if (!this.currentLoadedImage) {
                this.loadImage(this.currentImageId);
            }
        }, error => {
            console.log(error)
        });
    }

    loadImage(index: number) {
        this.currentLoadedImage = this.imagesData[index];
    }

    makeXhr() {
        const xhr = new TNSXMLHttpRequest();
        xhr.timeout = 30000;
        this.addListeners(xhr);
        this.addUploadListeners(xhr);
        xhr.onloadstart = function () {
            console.log('loadstart');
        };
        xhr.onloadend = function () {
            console.log('loadend', 'url', xhr.responseURL);
        };
        xhr.onprogress = function () {
            console.log('progress');
        };
        xhr.ontimeout = function () {
            console.log('timeout');
        };
        xhr.onabort = function () {
            console.log('makeXhr abort');
        };

        xhr.onreadystatechange = function () {
            console.log('state', xhr.readyState, 'status', xhr.status);
            if (xhr.readyState === 4 && xhr.status === 200) {
                console.log('response', !!xhr.response);
                console.log('responseText', xhr.responseText);
            }
        };

        xhr.onerror = function () {
            console.log('onerror');
        };
        xhr.open('POST', 'https://enipgm8id26wn.x.pipedream.net/');
        //xhr.open('GET', 'https://randomuser.me/api/');
        xhr.responseType = 'json';
        xhr.setRequestHeader('x-token', 'Osei');
        xhr.send();
    }

    base64Xhr() {
        const xhr = new TNSXMLHttpRequest();
        xhr.timeout = 30000;
        this.addListeners(xhr);
        this.addUploadListeners(xhr);
        xhr.onloadstart = function () {
            console.log('loadstart');
        };
        xhr.onloadend = function () {
            console.log('loadend', 'url', xhr.responseURL);
        };
        xhr.onprogress = function () {
            console.log('progress');
        };
        xhr.ontimeout = function () {
            console.log('timeout');
        };

        xhr.onreadystatechange = function () {
            console.log('state', xhr.readyState, 'status', xhr.status);
            if (xhr.readyState === 4 && xhr.status === 200) {
                console.log('response', !!xhr.response);
                console.log('responseText', xhr.responseText);
            }
        };

        xhr.onerror = function () {
            console.log('onerror');
        };
        //'https://somewhere.org/i-dont-exist'
        // https://enipgm8id26wn.x.pipedream.net/
        //
        xhr.open('POST', `https://enipgm8id26wn.x.pipedream.net/`);
        xhr.setRequestHeader('x-token', 'Osei');
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send({
            image: 'dxtcyvubgihojpkiukjvgchasvjbkdnlmaksopdjoaibsvcdjhbksjnlko;\'sjpiohuydjgvahbksjnlk;jalshkbjvghdjhbknljdhvgashbknljdhkvjgahksnld;jlhkbajvgshbknldlhkbv'
        });
    }

    showNext() {
        if (this.currentImageId === this.imagesData.length) {
            return;
        }
        this.currentImageId = this.currentImageId += 1;
        this.loadImage(this.currentImageId);
    }

    showPrevious() {
        if (this.currentImageId === 0) {
            return;
        }
        this.currentImageId = this.currentImageId -= 1;
        this.loadImage(this.currentImageId);
    }

    getRandomUser() {
        const xhr = new TNSXMLHttpRequest();
        xhr.timeout = 30000;
        this.addListeners(xhr);
        this.addUploadListeners(xhr);
        xhr.onloadstart = function () {
            console.log('loadstart');
        };
        xhr.onloadend = function () {
            console.log('loadend', 'url', xhr.responseURL);
        };
        xhr.onprogress = function () {
            console.log('progress');
        };
        xhr.ontimeout = function () {
            console.log('timeout');
        };
        xhr.onabort = function () {
            console.log('makeXhr abort');
        };

        xhr.onreadystatechange = () => {
            if (xhr.readyState === 4 && xhr.status === 200) {
                this.randomUsers.push(xhr.response);
            }
        };
        xhr.onerror = function () {
            console.log('onerror');
        };
        xhr.open('GET', 'https://randomuser.me/api/');
        xhr.responseType = 'json';
        xhr.setRequestHeader('x-token', 'Osei');
        xhr.send();
    }

}
