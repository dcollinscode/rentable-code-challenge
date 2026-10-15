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
 * fixtures below mirror that shape. The first request always carries the
 * default sort (?ordering=id), since "Default order" asks for raw DB order.
 */

// The default sort ("Default order" -> raw DB order) sends ?ordering=id, so the
// very first request the component makes is this URL.
const DEFAULT_URL = '/api/tenants/?ordering=id';
const DEFAULT_PAGE_TWO_URL = '/api/tenants/?ordering=id&page=2';

// Ordered first-page URLs the component is expected to build.
const ORDER_ASC_URL = '/api/tenants/?ordering=name';
const ORDER_DESC_URL = '/api/tenants/?ordering=-name';

function makeTenant(id: number, name: string): Tenant {
  return { id, name, unit: `U${id}`, pms_tenant_id: id };
}

// 30 tenants, 25 on page 1 and 5 on page 2 (the live-app default page size).
const pageOne = {
  count: 30,
  next: DEFAULT_PAGE_TWO_URL,
  previous: null,
  results: Array.from({ length: 25 }, (_, i) => makeTenant(i + 1, `Tenant ${i + 1}`)),
};
const pageTwo = {
  count: 30,
  next: null,
  previous: DEFAULT_URL,
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

/** The default happy-path server: page 1 and page 2 in the default order. */
function mockPagedServer() {
  mockFetch(async (url) => {
    if (url === DEFAULT_URL) return jsonResponse(pageOne);
    if (url === DEFAULT_PAGE_TWO_URL) return jsonResponse(pageTwo);
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
      DEFAULT_PAGE_TWO_URL,
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
      if (url === DEFAULT_URL) return jsonResponse(pageOne);
      if (url === DEFAULT_PAGE_TWO_URL) {
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

/**
 * Sorting behaviour. The toolbar's "Sort by" dropdown maps to the backend's
 * ?ordering param: "id" -> default/raw DB order, "name" -> A–Z, "-name" -> Z–A.
 */
describe('TenantList sorting', () => {
  // Z–A ordering (as the server would return for ?ordering=-name).
  const orderedDescPage = {
    count: 2,
    next: null,
    previous: null,
    results: [makeTenant(2, 'Zed'), makeTenant(1, 'Anna')],
  };

  /** Serve the default page, the ordered page, and the descending-ordered page. */
  function mockSortServer(overrides: Record<string, unknown> = {}) {
    const routes: Record<string, unknown> = {
      [DEFAULT_URL]: pageOne,
      [DEFAULT_PAGE_TWO_URL]: pageTwo,
      [ORDER_DESC_URL]: orderedDescPage,
      ...overrides,
    };
    mockFetch(async (url) => {
      if (url in routes) return jsonResponse(routes[url]);
      return new Response(JSON.stringify({ detail: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  }

  test('renders the Sort by dropdown with default, A–Z and Z–A options', async () => {
    mockSortServer();

    render(<TenantList />);
    await screen.findByText('Tenant 1');

    const select = screen.getByLabelText('Sort by');
    expect(select).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Default order' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Name (A–Z)' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Name (Z–A)' })).toBeInTheDocument();
  });

  test('selecting "Name (Z–A)" requests ?ordering=-name and reorders the table', async () => {
    mockSortServer();

    render(<TenantList />);
    await screen.findByText('Tenant 1');

    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'Name (Z–A)');

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        ORDER_DESC_URL,
        expect.objectContaining({ headers: { Accept: 'application/json' } })
      )
    );

    // Wait for the reordered rows to render, then assert their order.
    await screen.findByText('Zed');
    const rows = screen.getAllByRole('row');
    // rows[0] is the header; the first data row should be "Zed".
    expect(within(rows[1]).getByText('Zed')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Anna')).toBeInTheDocument();
  });

  test('selecting "Name (A–Z)" requests ?ordering=name', async () => {
    mockSortServer({ [ORDER_ASC_URL]: orderedDescPage });

    render(<TenantList />);
    await screen.findByText('Tenant 1');

    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'Name (A–Z)');

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        ORDER_ASC_URL,
        expect.objectContaining({ headers: { Accept: 'application/json' } })
      )
    );
  });

  test('the initial load requests the default (DB) order explicitly', async () => {
    mockSortServer();

    render(<TenantList />);
    await screen.findByText('Tenant 1');

    // The first fetch asks for ?ordering=id (raw DB order), not the bare URL.
    expect(global.fetch).toHaveBeenCalledWith(
      DEFAULT_URL,
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
    expect(screen.getByLabelText('Sort by')).toHaveValue('id');
  });

  test('selecting "Default order" requests ?ordering=id', async () => {
    mockSortServer();

    render(<TenantList />);
    await screen.findByText('Tenant 1');

    // Go to Z–A first, then back to the default order.
    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'Name (Z–A)');
    await screen.findByText('Zed');

    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'Default order');

    // The last request must ask for the default (DB) order explicitly.
    await waitFor(() => {
      const calls = (global.fetch as jest.Mock).mock.calls.map((c) => String(c[0]));
      const last = calls[calls.length - 1];
      expect(last).toBe(DEFAULT_URL);
    });
    expect(await screen.findByText('Tenant 1')).toBeInTheDocument();
  });

  test('changing the sort resets pagination to page 1', async () => {
    mockSortServer();

    render(<TenantList />);
    await screen.findByText('Tenant 1');

    // Go to page 2 first.
    userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Tenant 26');

    // Changing sort must restart at page 1 of the ordered set, not page 2.
    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'Name (Z–A)');
    await screen.findByText('Zed');

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        ORDER_DESC_URL,
        expect.objectContaining({ headers: { Accept: 'application/json' } })
      )
    );
    // It must NOT request a page=2 variant of the ordered URL.
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/tenants/?ordering=-name&page=2',
      expect.anything()
    );
  });

  test('pagination preserves the active sort (Next follows the ordered link)', async () => {
    const ORDER_DESC_PAGE_TWO_URL = '/api/tenants/?ordering=-name&page=2';
    const orderedDescFirstPage = {
      count: 30,
      next: ORDER_DESC_PAGE_TWO_URL,
      previous: null,
      results: Array.from({ length: 25 }, (_, i) => makeTenant(100 + i, `Sorted ${i + 1}`)),
    };
    const orderedDescSecondPage = {
      count: 30,
      next: null,
      previous: ORDER_DESC_URL,
      results: Array.from({ length: 5 }, (_, i) => makeTenant(200 + i, `Sorted Next ${i + 1}`)),
    };

    mockSortServer({
      [ORDER_DESC_URL]: orderedDescFirstPage,
      [ORDER_DESC_PAGE_TWO_URL]: orderedDescSecondPage,
    });

    render(<TenantList />);
    await screen.findByText('Tenant 1');

    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'Name (Z–A)');
    await screen.findByText('Sorted 1');

    // Clicking Next must follow the server's ordered next link as-is.
    userEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Sorted Next 1')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      ORDER_DESC_PAGE_TWO_URL,
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
    expect(screen.getByText(/Showing\s*26–30 of 30 tenants/)).toBeInTheDocument();
  });
});
