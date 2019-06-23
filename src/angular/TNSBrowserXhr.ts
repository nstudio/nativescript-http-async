import { XhrFactory } from '@angular/common/http';
import { TNSXMLHttpRequest } from '../xhr/TNSXMLHttpRequest';
import { Injectable } from '@angular/core';

@Injectable()
export class TNSBrowserXhr extends XhrFactory {
    build(): XMLHttpRequest {
        return new TNSXMLHttpRequest();
    }
}
