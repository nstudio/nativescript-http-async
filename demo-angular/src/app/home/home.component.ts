import { Component, OnInit } from '@angular/core';
import { DataService } from '~/app/services/data.service';

@Component({
    selector: 'Home',
    moduleId: module.id,
    templateUrl: './home.component.html'
})
export class HomeComponent implements OnInit {

    constructor(private dataService: DataService) {
        // Use the component constructor to inject providers.
    }

    async downloadLargeFile() {
        try {
            const file = await this.dataService.downloadLargeFile(progress => {
                console.log('large file progress:', progress);
            });
            console.log('large file result', file);
        } catch (e) {
            console.log('downloadLargeFile error: ', e);
        }
    }

    ngOnInit(): void {
        // Init your component properties here.
    }


    getRandomUser() {
        this.dataService.getRandomUser();
    }

    getRandomUsers(count: any, users: any) {
        this.dataService.getRandomUsers(count, users);
    }

    makeRequest() {
        this.dataService.makeRequest();
    }

    makeXhr() {
        this.dataService.makeXhr();
    }

    base64Xhr() {
        this.dataService.base64Xhr();
    }

    showNext() {
        this.dataService.showNext();
    }

    showPrevious() {
        this.dataService.showPrevious();
    }
}
