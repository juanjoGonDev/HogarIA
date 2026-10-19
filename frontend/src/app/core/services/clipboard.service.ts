import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ClipboardService {
  private readonly document = inject(DOCUMENT);

  async copy(text: string): Promise<void> {
    const clipboard = this.document.defaultView?.navigator.clipboard;
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      return;
    }

    this.copyWithLegacyApi(text);
  }

  private copyWithLegacyApi(text: string): void {
    const textarea = this.document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    this.document.body.appendChild(textarea);

    try {
      textarea.select();
      if (!this.document.execCommand('copy')) {
        throw new Error('The browser rejected the clipboard copy command.');
      }
    } finally {
      textarea.remove();
    }
  }
}
