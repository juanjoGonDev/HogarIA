import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-page-container',
  standalone: true,
  template: '<ng-content></ng-content>',
  host: {
    class: 'page-container',
    '[class.page-container--bounded]': 'bounded',
    '[class.page-container--full-content]': 'fullContent'
  }
})
export class PageContainerComponent {
  @Input() bounded = false;
  @Input() fullContent = true;
}
