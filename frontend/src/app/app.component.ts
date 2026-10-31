import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { STORAGE_KEYS } from './core/services/storage.service';
import { AppUpdateService } from './core/services/app-update.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: ` <router-outlet></router-outlet> `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
      }
    `
  ]
})
export class AppComponent implements OnInit {
  private readonly appUpdate = inject(AppUpdateService);

  ngOnInit(): void {
    this.appUpdate.initialize();
    // Initialize theme from localStorage
    const theme = localStorage.getItem(STORAGE_KEYS.theme) || 'light';
    document.documentElement.setAttribute('data-theme', theme);
  }
}
