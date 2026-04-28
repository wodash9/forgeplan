import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import App from '../src/app/App.js';

describe('ForgePlan visual plant editor', () => {
  it('renders the demo plant and readiness state', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Visual Plant Editor MVP' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ForgePlan Demo Plant' })).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.getByTestId('forgeplan-flow-canvas')).toBeInTheDocument();
    expect(screen.getAllByText('Mixer 1').length).toBeGreaterThan(0);
  });

  it('adds a mixer node and selects it', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Add mixer' }));

    expect(screen.getAllByText('Mixer 2').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Mixer 2' })).toBeInTheDocument();
  });

  it('edits the selected node name and capacity', async () => {
    const user = userEvent.setup();
    render(<App />);

    const nameInput = screen.getByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Primary Mixer');

    const capacityInput = screen.getByLabelText('Capacity');
    await user.clear(capacityInput);
    await user.type(capacityInput, '150');

    expect(screen.getAllByText('Primary Mixer').length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('150')).toBeInTheDocument();
  });
});
