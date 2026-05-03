import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import LandingPage from '../src/app/LandingPage.js';

describe('ForgePlan landing page', () => {
  it('presents a planner-facing value proposition and links to the demo', () => {
    render(<LandingPage />);

    expect(screen.getByRole('heading', { name: /comprueba si tu plan de producción cabe/i })).toBeInTheDocument();
    expect(screen.getByText(/Excel que nadie se atreve a tocar/i)).toBeInTheDocument();
    expect(screen.getByText(/Demo pública con solver mock/i)).toBeInTheDocument();

    const demoLinks = screen.getAllByRole('link', { name: /demo/i });
    expect(demoLinks.some((link) => link.getAttribute('href') === '/demo')).toBe(true);
  });
});
