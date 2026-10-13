import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import TenantList from './TenantList';
import { Tenant } from './types';

/**
 * Tests for the paginated tenant table. We mock `fetch` (not the api module)
 * so the real request/error handling in `api/tenants.ts` is exercised end to
 * end, and we serve responses keyed on the requested URL — which also proves
 * the component follows the server's next/previous links rather than
 * reconstructing them.
 *
 * The backend returns PATH-RELATIVE links (e.g. "/api/tenants/?page=2"), so the
 * fixtures below mirror that shape.
 */

const PAGE_ONE_URL = '/api/tenants/';
const PAGE_TWO_URL = '/api/tenants/?page=2';

function makeTenant(id: number, name: string): Tenant {
  return { id, name, unit: `U${id}`, pms_tenant_id: id };
}

// 30 tenants, 25 on page 1 and 5 on page 2 (the live-app default page size).
const pageOne = {
  count: 30,
  next: PAGE_TWO_URL,
  previous: null,
  results: Array.from({ length: 25 }, (_, i) => makeTenant(i + 1, `Tenant ${i + 1}`)),
};
const pageTwo = {
  count: 30,
  next: null,
  previous: PAGE_ONE_URL,
  results: Array.from({ length: 5 }, (_, i) => makeTenant(i + 26, `Tenant ${i + 26}`)),
};

/** Serve a canned JSON body (200) for a given URL. */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const mockFetch = (impl: (url: string) => Promise<Response>) => {
  global.fetch = jest.fn((input: RequestInfo | URL) =>
    impl(String(input))
  ) as unknown as typeof fetch;
};

/** The default happy-path server: page 1 at the bare URL, page 2 at ?page=2. */
function mockPagedServer() {
  mockFetch(async (url) => {
    if (url === PAGE_ONE_URL) return jsonResponse(pageOne);
    if (url === PAGE_TWO_URL) return jsonResponse(pageTwo);
    return new Response(JSON.stringify({ detail: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

afterEach(() => {
  jest.resetAllMocks();
});

describe('TenantList', () => {
  test('renders page 1 with Next enabled and Previous disabled', async () => {
    mockPagedServer();

    render(<TenantList />);

    // Rows for page 1 render once the fetch resolves.
    expect(await screen.findByText('Tenant 1')).toBeInTheDocument();
    expect(screen.getByText('Tenant 25')).toBeInTheDocument();
    expect(screen.queryByText('Tenant 26')).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  test('clicking Next fetches the next URL and replaces the rows', async () => {
    mockPagedServer();

    render(<TenantList />);
    await screen.findByText('Tenant 1');

    userEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Page 2 rows replace page 1 rows.
    expect(await screen.findByText('Tenant 26')).toBeInTheDocument();
    expect(screen.getByText('Tenant 30')).toBeInTheDocument();
    expect(screen.queryByText('Tenant 1')).not.toBeInTheDocument();

    // The server-provided (relative) next link is followed as-is.
    expect(global.fetch).toHaveBeenCalledWith(
      PAGE_TWO_URL,
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );

    // At the end of the list, Next is disabled and Previous is enabled.
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
  });

  test('clicking Previous on page 2 returns to page 1', async () => {
    mockPagedServer();

    render(<TenantList />);
    await screen.findByText('Tenant 1');
    userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Tenant 26');

    userEvent.click(screen.getByRole('button', { name: 'Previous' }));

    expect(await screen.findByText('Tenant 1')).toBeInTheDocument();
    expect(screen.queryByText('Tenant 26')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  test('pagination load error shows retry; retry re-fetches the page', async () => {
    let pageTwoCalls = 0;

    mockFetch(async (url) => {
      if (url === PAGE_ONE_URL) return jsonResponse(pageOne);
      if (url === PAGE_TWO_URL) {
        pageTwoCalls += 1;
        if (pageTwoCalls === 1) {
          return new Response(JSON.stringify({ detail: 'Boom' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return jsonResponse(pageTwo);
      }
      return jsonResponse({ detail: 'Not found' });
    });

    render(<TenantList />);
    await screen.findByText('Tenant 1');

    userEvent.click(screen.getByRole('button', { name: 'Next' }));

    // The inline error appears under the table; page 1 rows are still shown.
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
    expect(screen.getByText('Tenant 1')).toBeInTheDocument();

    // Retry re-fetches the same page and succeeds.
    userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Tenant 26')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(pageTwoCalls).toBe(2);
  });

  test('"Showing X–Y of Z" reflects the current page and total', async () => {
    mockPagedServer();

    render(<TenantList />);
    await screen.findByText('Tenant 1');

    // Page 1: rows 1..25 of 30.
    expect(screen.getByText(/Showing\s*1–25 of 30 tenants/)).toBeInTheDocument();

    userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Tenant 26');

    // Page 2: rows 26..30 of 30 (last page, shorter).
    expect(screen.getByText(/Showing\s*26–30 of 30 tenants/)).toBeInTheDocument();
  });

  test('initial load error shows an inline message and retry re-fetches', async () => {
    let calls = 0;

    mockFetch(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ detail: 'Server down' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return jsonResponse(pageOne);
    });

    render(<TenantList />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Server down');

    userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Tenant 1')).toBeInTheDocument();
    expect(calls).toBe(2);
  });
});
