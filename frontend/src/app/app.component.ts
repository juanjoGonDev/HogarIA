import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { STORAGE_KEYS } from './core/services/storage.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <router-outlet></router-outlet>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
    }
  `]
})
export class AppComponent implements OnInit {
  ngOnInit(): void {
    // Initialize theme from localStorage
    const theme = localStorage.getItem(STORAGE_KEYS.theme) || 'light';
    document.documentElement.setAttribute('data-theme', theme);
  }
}
