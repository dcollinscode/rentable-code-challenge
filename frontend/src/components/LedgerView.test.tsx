import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import LedgerView from './LedgerView';
import { Tenant } from '../types';

/**
 * Tests for the ledger drawer. We mock `fetch` (not the api module) so the
 * real request/error handling in `api/ledger.ts` is exercised end to end.
 */

const tenant: Tenant = {
  id: 1,
  name: 'Alice Wonderland',
  unit: 'A101',
  pms_tenant_id: 1,
};

/** A ledger response with a balance and two transactions. */
const livePayload = {
  count: 2,
  next: null,
  previous: null,
  tenant: { id: 1, tenant_id: 1, name: 'Alice Wonderland', unit: 'A101' },
  balance: '1250.00',
  transaction_count: 2,
  results: [
    {
      id: 4,
      external_id: 4,
      date: '2022-12-21',
      description: 'Rent Charge',
      amount: '500.00',
      type: 'charge',
    },
    {
      id: 5,
      external_id: 5,
      date: '2022-12-22',
      description: 'Payment',
      amount: '250.00',
      type: 'payment',
    },
  ],
};

/** A response with a zero balance and no transactions. */
const emptyPayload = {
  ...livePayload,
  count: 0,
  balance: '0.00',
  transaction_count: 0,
  results: [],
};

const mockFetch = (impl: (url: string) => Promise<Response>) => {
  global.fetch = jest.fn((input: RequestInfo | URL) =>
    impl(String(input))
  ) as unknown as typeof fetch;
};

afterEach(() => {
  jest.resetAllMocks();
});

const renderLedger = () =>
  render(<LedgerView tenant={tenant} onClose={() => {}} />);

describe('LedgerView', () => {
  test('renders the loading state while the fetch is in flight', async () => {
    // A fetch that never resolves keeps the component in its loading state.
    mockFetch(() => new Promise<Response>(() => {}));

    renderLedger();

    expect(await screen.findByText('Loading ledger…')).toBeInTheDocument();
    expect(
      screen.getByText('Loading ledger…').closest('[aria-busy]')
    ).toHaveAttribute('aria-busy', 'true');
  });

  test('renders the empty state for an empty ledger', async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify(emptyPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    renderLedger();

    expect(
      await screen.findByText('No transactions on record for this tenant')
    ).toBeInTheDocument();
    // The zero balance is still shown.
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('renders the error state when the fetch fails', async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ detail: 'Ledger unavailable' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    renderLedger();

    expect(
      await screen.findByText('Couldn’t load this ledger')
    ).toBeInTheDocument();
    expect(screen.getByText('Ledger unavailable')).toBeInTheDocument();
    // A retry affordance is offered.
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  test('renders transactions with correct currency formatting', async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify(livePayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    renderLedger();

    // Balance: "1250.00" -> "$1,250.00".
    expect(await screen.findByText('$1,250.00')).toBeInTheDocument();

    // Charge renders as its signed (positive) magnitude, payment as negative.
    expect(screen.getByText('Rent Charge')).toBeInTheDocument();
    expect(screen.getByText('$500.00')).toBeInTheDocument();
    expect(screen.getByText('Payment')).toBeInTheDocument();
    expect(screen.getByText('-$250.00')).toBeInTheDocument();

    // A table with the transaction rows is present.
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2 rows
  });

  test('fetches the correct endpoint for the tenant', async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify(livePayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    renderLedger();

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/tenants/1/ledger/',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
  });
});
