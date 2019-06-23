import { NgModule } from '@angular/core';
import { TNSBrowserXhr } from './TNSBrowserXhr';
import { XhrFactory } from '@angular/common/http';

@NgModule({
    providers: [
        TNSBrowserXhr,
        {provide: XhrFactory, useExisting: TNSBrowserXhr}
    ]
})
export class NativeScriptAsyncModule {
}
