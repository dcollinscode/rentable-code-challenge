import React, { useCallback, useEffect, useRef, useState } from 'react';
import LedgerView from './components/LedgerView';
import { getTenantsByUrl, TenantsApiError } from './api/tenants';
import { Paginated, Tenant } from './types';
import './App.css';

/** The first page is always fetched from the bare endpoint. */
const BASE_URL = '/api/tenants/';

/**
 * The "Sort by" choices exposed in the toolbar. `value` is exactly the
 * `ordering` query value the backend accepts (see backend/api/views.py), so
 * "Default order" asks for the raw database order (id ascending) explicitly
 * rather than relying on the endpoint's implicit default.
 */
type OrderingValue = 'id' | 'name' | '-name';

interface OrderingOption {
    value: OrderingValue;
    label: string;
}

const ORDERING_OPTIONS: OrderingOption[] = [
    { value: 'id', label: 'Default order' },
    { value: 'name', label: 'Name (A–Z)' },
    { value: '-name', label: 'Name (Z–A)' },
];

/** The sort applied on first render (raw database order). */
const DEFAULT_ORDERING: OrderingValue = 'id';

/**
 * Build the *first-page* URL for the given ordering.
 *
 * Pagination beyond page 1 is driven entirely by the server's `next`/`previous`
 * links (which already carry the query string), so this is only used to restart
 * at page 1 whenever the sort changes. Reconstructing only the first page keeps
 * the client from having to re-derive the canonical query string on every page.
 */
function buildFirstPageUrl(ordering: OrderingValue): string {
    const params = new URLSearchParams();
    params.set('ordering', ordering);
    return `${BASE_URL}?${params.toString()}`;
}

/**
 * One entry in the pagination history. We keep the URL we fetched *and* the
 * 0-based offset of its first row so "Showing X–Y of Z" is exact on every page
 * (including the last, whose length differs) without re-deriving it from the
 * server.
 */
interface PageEntry {
    url: string;
    offset: number;
}

/** What the user sees while a request is in flight. */
type LoadKind = 'initial' | 'page' | 'sort' | null;

function errorMessage(err: unknown): string {
    if (err instanceof TenantsApiError) {
        return err.detail ?? err.message;
    }
    if (err instanceof Error) {
        return err.message;
    }
    return 'Unknown error';
}

const SkeletonRows: React.FC = () => (
    <tbody aria-busy="true" aria-live="polite">
        <tr className="tenant-visually-hidden">
            <td colSpan={4}>Loading tenants…</td>
        </tr>
        {Array.from({ length: 8 }).map((_, i) => (
            <tr key={i} className="tenant-skeleton__row">
                <td><span className="tenant-skeleton__cell" /></td>
                <td><span className="tenant-skeleton__cell" /></td>
                <td><span className="tenant-skeleton__cell" /></td>
                <td><span className="tenant-skeleton__cell tenant-skeleton__cell--sm" /></td>
            </tr>
        ))}
    </tbody>
);

function TenantList() {
    const [data, setData] = useState<Paginated<Tenant> | null>(null);
    const [loadKind, setLoadKind] = useState<LoadKind>('initial');
    // Errors are split: a first-load failure replaces the table, a paging or
    // sort failure is shown *under* the table while the current rows stay put.
    const [initialError, setInitialError] = useState<string | null>(null);
    const [pageError, setPageError] = useState<string | null>(null);

    // The active sort. Defaults to the raw database order.
    const [ordering, setOrdering] = useState<OrderingValue>(DEFAULT_ORDERING);

    // History stack of visited pages + the index of the current one. This lets
    // Previous walk back to the exact offset the user came from. The first entry
    // uses the default ordering's first-page URL.
    const [history, setHistory] = useState<PageEntry[]>([
        { url: buildFirstPageUrl(DEFAULT_ORDERING), offset: 0 },
    ]);
    const [historyIndex, setHistoryIndex] = useState(0);

    const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);

    const tableContainerRef = useRef<HTMLDivElement | null>(null);
    // Guards against out-of-order responses when pages/sorts change quickly.
    const requestIdRef = useRef(0);

    const currentEntry = history[historyIndex];

    const scrollTableToTop = () => {
        // Only reset the table container's scroll, never the whole page.
        // `scrollTo` is not implemented in jsdom, so guard it.
        const el = tableContainerRef.current;
        if (el && typeof el.scrollTo === 'function') {
            el.scrollTo({ top: 0 });
        } else if (el) {
            el.scrollTop = 0;
        }
    };

    const load = useCallback((entry: PageEntry, kind: LoadKind) => {
        const requestId = ++requestIdRef.current;
        setLoadKind(kind);
        setPageError(null);
        if (kind === 'initial') {
            setInitialError(null);
        }

        getTenantsByUrl(entry.url)
            .then((response) => {
                // A newer request superseded this one — discard the result.
                if (requestId !== requestIdRef.current) return;
                setData(response);
                setLoadKind(null);
            })
            .catch((err: unknown) => {
                if (requestId !== requestIdRef.current) return;
                setLoadKind(null);
                if (kind === 'initial') {
                    setInitialError(errorMessage(err));
                } else {
                    setPageError(errorMessage(err));
                }
            });
    }, []);

    // Initial load (and the initial-load retry, which reuses this effect).
    const [initialReloadToken, setInitialReloadToken] = useState(0);
    useEffect(() => {
        load(history[0], 'initial');
        // Only re-run for the retry token; `load` is stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, initialReloadToken]);

    /**
     * Apply a new sort by resetting the history to a single first-page entry.
     * Resetting (rather than reusing the current page) is deliberate: changing
     * the sort while on page 3 must not request page 3 of the new result set,
     * which is almost always empty.
     */
    const applySort = useCallback(
        (nextOrdering: OrderingValue) => {
            const entry: PageEntry = {
                url: buildFirstPageUrl(nextOrdering),
                offset: 0,
            };
            setHistory([entry]);
            setHistoryIndex(0);
            scrollTableToTop();
            load(entry, 'sort');
        },
        // `scrollTableToTop` only reads a ref and `load` is stable, so this
        // callback is stable. `history` is intentionally NOT a dependency: we
        // always restart from a fresh single-entry history here.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [load]
    );

    /** Follow the server-provided `next`/`previous` link directly. */
    const goToPage = (url: string, direction: 'next' | 'prev') => {
        if (!data) return;

        let entry: PageEntry;
        if (direction === 'next') {
            // Compute this page's end offset from the rows currently shown.
            const offset = currentEntry.offset + data.results.length;
            entry = { url, offset };
            // Commit the navigation immediately (before the fetch resolves) so
            // that a failed load still knows which page it was asking for and
            // Retry can re-fetch it.
            setHistory([...history.slice(0, historyIndex + 1), entry]);
            setHistoryIndex(historyIndex + 1);
        } else {
            // Walk back one entry in the history stack.
            entry = history[historyIndex - 1];
            setHistoryIndex(historyIndex - 1);
        }

        scrollTableToTop();
        load(entry, 'page');
    };

    const handleOrderingChange = (value: string) => {
        const next = (
            ORDERING_OPTIONS.find((o) => o.value === value)?.value ?? DEFAULT_ORDERING
        ) as OrderingValue;
        if (next === ordering) return;
        setOrdering(next);
        // A discrete dropdown choice — no debounce. Restart at page 1.
        applySort(next);
    };

    const retryPage = () => {
        // Re-fetch the page we last asked for, with the same offset.
        load(currentEntry, 'page');
    };

    const retryInitial = () => setInitialReloadToken((n) => n + 1);

    // The toolbar is shared by every render branch (initial skeleton, initial
    // error, and the loaded table) so it stays mounted across load states.
    const toolbar = (
        <div className="tenant-toolbar">
            <label className="tenant-toolbar__field">
                <span className="tenant-toolbar__label">Sort by</span>
                <select
                    className="tenant-toolbar__select"
                    value={ordering}
                    onChange={(e) => handleOrderingChange(e.target.value)}
                    aria-label="Sort by"
                >
                    {ORDERING_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
            </label>
        </div>
    );

    // --- Initial loading: skeleton rows ---
    if (loadKind === 'initial') {
        return (
            <div className="tenant-list">
                <h2>Tenants</h2>
                {toolbar}
                <div className="tenant-table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Name</th>
                                <th>Unit</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <SkeletonRows />
                    </table>
                </div>
            </div>
        );
    }

    // --- Initial load error: inline message + retry ---
    if (initialError || !data) {
        return (
            <div className="tenant-list">
                <h2>Tenants</h2>
                {toolbar}
                <div className="tenant-state tenant-state--error" role="alert">
                    <p className="tenant-state__title">Couldn’t load tenants</p>
                    <p className="tenant-state__detail">
                        {initialError ?? 'Something went wrong.'}
                    </p>
                    <button type="button" className="tenant-btn" onClick={retryInitial}>
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    const { count, next, previous, results } = data;
    const start = count === 0 ? 0 : currentEntry.offset + 1;
    const end = currentEntry.offset + results.length;
    // Page changes and sort changes both keep the current rows visible but
    // dimmed — the table is never blanked mid-refetch for a sort change.
    const isBusy = loadKind === 'page' || loadKind === 'sort';

    return (
        <div className="tenant-list">
            <h2>Tenants</h2>

            {toolbar}

            {count === 0 ? (
                <p className="tenant-empty">No tenants found.</p>
            ) : (
                <div
                    className={`tenant-table-container${isBusy ? ' tenant-table-container--loading' : ''}`}
                    ref={tableContainerRef}
                    aria-busy={isBusy}
                >
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Name</th>
                                <th>Unit</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {results.map(tenant => (
                                <tr key={tenant.id}>
                                    <td>{tenant.id}</td>
                                    <td>{tenant.name}</td>
                                    <td>{tenant.unit}</td>
                                    <td>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedTenant(tenant)}
                                        >
                                            View Ledger
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {pageError && (
                <div className="tenant-page-error" role="alert">
                    <span className="tenant-page-error__message">
                        Couldn’t load that page: {pageError}
                    </span>
                    <button type="button" className="tenant-btn" onClick={retryPage}>
                        Retry
                    </button>
                </div>
            )}

            <div className="tenant-pagination">
                <span className="tenant-pagination__summary" aria-live="polite">
                    Showing {start}–{end} of {count} tenants
                    {isBusy && <span className="tenant-pagination__spinner" aria-label="Loading" />}
                </span>
                <div className="tenant-pagination__controls">
                    <button
                        type="button"
                        className="tenant-btn"
                        onClick={() => previous && goToPage(previous, 'prev')}
                        disabled={!previous || isBusy}
                    >
                        Previous
                    </button>
                    <button
                        type="button"
                        className="tenant-btn"
                        onClick={() => next && goToPage(next, 'next')}
                        disabled={!next || isBusy}
                    >
                        Next
                    </button>
                </div>
            </div>

            {selectedTenant && (
                <LedgerView
                    key={selectedTenant.id}
                    tenant={selectedTenant}
                    onClose={() => setSelectedTenant(null)}
                />
            )}
        </div>
    );
}

export default TenantList;
