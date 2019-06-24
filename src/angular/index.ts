import { NgModule, ModuleWithProviders, Optional, SkipSelf } from '@angular/core';
import { TNSBrowserXhr } from './TNSBrowserXhr';
import { XhrFactory } from '@angular/common/http';
import { TNSHttpDebugging } from '../http/http-request-common';

const BASE_PROVIDERS = [
    TNSBrowserXhr,
    {provide: XhrFactory, useExisting: TNSBrowserXhr}
];

@NgModule({
    providers: BASE_PROVIDERS
})
export class NativeScriptHttpAsyncModule {
  static forRoot(options: { configuredProviders?: Array<any>; debug?: boolean; }): ModuleWithProviders {
    if (options.debug) {
      TNSHttpDebugging.enabled = true;
    }
    return {
      ngModule: NativeScriptHttpAsyncModule,
      // Allow others to override if they need more control
      providers: [...BASE_PROVIDERS, ...(options.configuredProviders || [])]
    };
  }

  constructor(
    @Optional()
    @SkipSelf()
    parentModule: NativeScriptHttpAsyncModule
  ) {
    if (parentModule) {
      throw new Error(`NativeScriptHttpAsyncModule has already been loaded. Import NativeScriptHttpAsyncModule in the AppModule only.`);
    }
  }
}
