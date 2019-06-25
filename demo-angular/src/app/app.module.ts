import { NgModule, NO_ERRORS_SCHEMA } from '@angular/core';
import { NativeScriptModule } from 'nativescript-angular/nativescript.module';
import { NativeScriptHttpAsyncModule } from 'nativescript-http-async/angular';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { NativeScriptHttpClientModule } from 'nativescript-angular/http-client';

@NgModule({
    bootstrap: [
        AppComponent
    ],
    imports: [
        NativeScriptModule,
        NativeScriptHttpClientModule,
        NativeScriptHttpAsyncModule,
        AppRoutingModule
    ],
    declarations: [
        AppComponent
    ],
    schemas: [
        NO_ERRORS_SCHEMA
    ]
})
export class AppModule {
}
