import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

/**
 * A response with signed backend amounts. The UI's sign comes from the
 * transaction *type*, so a payment of "-250.00" must still render as
 * "-$250.00", not "$250.00".
 */
const signedPayload = {
  ...livePayload,
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
      amount: '-250.00', // backend already signed it
      type: 'payment',
    },
  ],
};

const originalFetch = global.fetch;

const mockFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) =>
    impl(String(input), init)
  ) as unknown as typeof fetch;
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => {
  // Restore the original fetch. resetAllMocks only clears mock state; it
  // leaves our fake fetch installed across test files.
  global.fetch = originalFetch;
  jest.resetAllMocks();
});

const renderLedger = (props?: Partial<React.ComponentProps<typeof LedgerView>>) =>
  render(<LedgerView tenant={tenant} onClose={() => {}} {...props} />);

describe('LedgerView', () => {
  test('renders the loading state while the fetch is in flight', async () => {
    // Resolve on the next microtask so the test doesn't leave a dangling
    // promise, but stays in loading state long enough to assert.
    let resolve!: (r: Response) => void;
    mockFetch(() => new Promise<Response>((r) => { resolve = r; }));

    renderLedger();

    expect(await screen.findByText('Loading ledger…')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');

    // Clean up the in-flight request.
    resolve(jsonResponse(livePayload));
    await waitFor(() =>
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    );
  });

  test('renders the empty state for an empty ledger', async () => {
    mockFetch(async () => jsonResponse(emptyPayload));

    renderLedger();

    expect(
      await screen.findByText('No transactions on record for this tenant')
    ).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('renders the error state when the fetch fails', async () => {
    mockFetch(async () =>
      jsonResponse({ detail: 'Ledger unavailable' }, 500)
    );

    renderLedger();

    expect(
      await screen.findByText('Couldn’t load this ledger')
    ).toBeInTheDocument();
    expect(screen.getByText('Ledger unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  test('falls back to a status message when the error body is not JSON', async () => {
    mockFetch(
      async () =>
        new Response('<html>500</html>', {
          status: 500,
          headers: { 'Content-Type': 'text/html' },
        })
    );

    renderLedger();

    expect(
      await screen.findByText('Couldn’t load this ledger')
    ).toBeInTheDocument();
    // LedgerApiError falls back to its own message when `detail` is absent.
    expect(screen.getByText(/Request failed with status 500/)).toBeInTheDocument();
  });

  test('retry re-fetches and recovers from an error', async () => {
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ detail: 'Ledger unavailable' }, 500)
        : jsonResponse(livePayload);
    });

    renderLedger();

    await screen.findByText('Ledger unavailable');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(await screen.findByText('$1,250.00')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('renders transactions with correct currency formatting', async () => {
    mockFetch(async () => jsonResponse(livePayload));

    renderLedger();

    expect(await screen.findByText('$1,250.00')).toBeInTheDocument();

    expect(screen.getByText('Rent Charge')).toBeInTheDocument();
    expect(screen.getByText('$500.00')).toBeInTheDocument();
    expect(screen.getByText('Payment')).toBeInTheDocument();
    expect(screen.getByText('-$250.00')).toBeInTheDocument();

    // Query body rows specifically rather than assuming the total row count.
    const table = screen.getByRole('table');
    const bodyRows = table.querySelectorAll('tbody tr');
    expect(bodyRows).toHaveLength(2);
  });

  test('payment sign comes from type, not from the backend amount sign', async () => {
    mockFetch(async () => jsonResponse(signedPayload));

    renderLedger();

    // A payment of "-250.00" must still render as "-$250.00".
    expect(await screen.findByText('-$250.00')).toBeInTheDocument();
    expect(screen.queryByText('$250.00')).not.toBeInTheDocument();
  });

  test('fetches the endpoint for the tenant id, not the pms_tenant_id', async () => {
    // Give the fixture distinct ids so we can tell which one drives the URL.
    const distinctTenant: Tenant = {
      ...tenant,
      id: 7,
      pms_tenant_id: 42,
    };

    mockFetch(async () => jsonResponse(livePayload));

    render(<LedgerView tenant={distinctTenant} onClose={() => {}} />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/tenants/7/ledger/',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
      })
    );
  });

  test('aborts the in-flight request on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockFetch((_url, init) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });

    const { unmount } = renderLedger();
    await waitFor(() => expect(capturedSignal).toBeDefined());

    unmount();

    expect(capturedSignal!.aborted).toBe(true);
  });

  test('dev override switches state without hitting the network', async () => {
    mockFetch(async () => jsonResponse(livePayload));

    const { rerender } = render(
      <LedgerView tenant={tenant} onClose={() => {}} overrideState="empty" />
    );

    expect(
      await screen.findByText('No transactions on record for this tenant')
    ).toBeInTheDocument();

    rerender(
      <LedgerView tenant={tenant} onClose={() => {}} overrideState="error" />
    );

    expect(
      await screen.findByText('Couldn’t load this ledger')
    ).toBeInTheDocument();

    expect(global.fetch).not.toHaveBeenCalled();
  });
});