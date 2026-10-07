import { createElement } from 'react';
import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';
import { MagicLinkEmail } from '../apps/api/src/MagicLinkEmail.js';

describe('MagicLinkEmail', () => {
  it('renders the one-time URL and customizable product name', async () => {
    const html = await render(
      createElement(MagicLinkEmail, {
        signInUrl: 'https://thread.example.com/api/auth/magic/verify?token=one-time',
        recipientName: 'Avery',
        productName: 'ArchThread Preview',
      }),
    );

    expect(html).toContain('https://thread.example.com/api/auth/magic/verify?token=one-time');
    expect(html).toContain('ArchThread Preview');
    expect(html).toContain('Hi Avery');
    expect(html).toContain('expires in 15 minutes');
  });
});
