import { TNSXMLHttpRequest } from 'nativescript-http-async';

/*
In NativeScript, a file with the same name as an XML file is known as
a code-behind file. The code-behind is a great place to place your view
logic, and to set up your page’s data binding.
*/

import { NavigatedData, Page } from "tns-core-modules/ui/page";

import { HomeViewModel } from "./home-view-model";
export function onNavigatingTo(args: NavigatedData) {
    const page = <Page>args.object;

    page.bindingContext = new HomeViewModel();
    const xhr = new TNSXMLHttpRequest();
    setTimeout(()=>{
        xhr.open('GET','~/assets/test.json');
        xhr.responseType = 'blob';
        xhr.onloadstart = ()=>{
            console.log('onstart');
        }
        xhr.onloadend = ()=>{
            console.log('onloadend')
        }
        xhr.onerror = ()=>{
            console.log('onerror');
        }
        xhr.onreadystatechange = function () {
            console.log('state', xhr.readyState, 'status', xhr.status);
            if (xhr.readyState === 4 && xhr.status === 200) {
                console.log('response', xhr.response);
                //console.log('responseText', xhr.responseText);
            }
        };
        xhr.send()
    })

}
