import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getLedger, LedgerApiError } from '../api/ledger';
import { LedgerResponse, Tenant, Transaction } from '../types';
import './LedgerView.css';

/**
 * Dev-only override used to force a given UI state for review. `null` (the
 * default) runs against the real API. See the toggle rendered by
 * `LedgerView` when `NODE_ENV !== 'production'`.
 */
export type LedgerStateOverride = 'loading' | 'empty' | 'error' | null;

interface LedgerViewProps {
  /** The tenant row the user clicked. Used for the title while loading. */
  tenant: Tenant;
  onClose: () => void;
  /** Dev-only: force a state instead of hitting the API. */
  overrideState?: LedgerStateOverride;
}

// --- Formatters (module-level so they aren't re-created on every render) ---

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

/** "2022-12-20" -> "Dec 20, 2022". Falls back to the raw string if unparsable. */
function formatDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }
  return dateFormatter.format(parsed);
}

/** A DRF decimal string ("1250.00") -> "$1,250.00". */
function formatCurrency(decimalString: string | number): string {
  const value = typeof decimalString === 'number'
    ? decimalString
    : Number(decimalString);
  if (Number.isNaN(value)) {
    return String(decimalString);
  }
  return currencyFormatter.format(value);
}

/**
 * Signed amount for a transaction: payments count against the balance.
 *
 * Uses `Math.abs` so that a backend that sends signed amounts (e.g.
 * `amount: "-250.00"` for a payment) doesn't get double-negated. The
 * transaction *type* is the source of truth for the sign.
 */
function signedAmount(txn: Transaction): number {
  const magnitude = Math.abs(Number(txn.amount));
  if (Number.isNaN(magnitude)) {
    return 0;
  }
  return txn.type === 'payment' ? -magnitude : magnitude;
}

// --- Sub-components for each state ---

const LedgerSkeleton: React.FC = () => (
  <div
    className="ledger-skeleton"
    role="status"
    aria-busy="true"
    aria-live="polite"
  >
    <span className="ledger-visually-hidden">Loading ledger…</span>
    <div className="ledger-skeleton__balance" />
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="ledger-skeleton__row" />
    ))}
  </div>
);

const LedgerError: React.FC<{ message: string; onRetry: () => void }> = ({
  message,
  onRetry,
}) => (
  <div className="ledger-state ledger-state--error" role="alert">
    <p className="ledger-state__title">Couldn’t load this ledger</p>
    <p className="ledger-state__detail">{message}</p>
    <button type="button" className="ledger-btn" onClick={onRetry}>
      Retry
    </button>
  </div>
);

const LedgerEmpty: React.FC = () => (
  <div className="ledger-state ledger-state--empty">
    <p className="ledger-state__title">
      No transactions on record for this tenant
    </p>
  </div>
);

// --- Focus trap hook (keeps Tab inside the drawer while it's open) ---

function useFocusTrap(
  containerRef: React.RefObject<HTMLElement>,
  isActive: boolean
) {
  useEffect(() => {
    if (!isActive) return;
    const container = containerRef.current;
    if (!container) return;

    // Remember where focus was so we can restore it on close.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the drawer on open.
    const focusables = container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusables[0];
    (first ?? container).focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const nodes = container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
      );
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const firstNode = nodes[0];
      const lastNode = nodes[nodes.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && active === firstNode) {
        e.preventDefault();
        lastNode.focus();
      } else if (!e.shiftKey && active === lastNode) {
        e.preventDefault();
        firstNode.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [containerRef, isActive]);
}

// --- Main component ---

const LedgerView: React.FC<LedgerViewProps> = ({
  tenant,
  onClose,
  overrideState = null,
}) => {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(overrideState === null);
  const [error, setError] = useState<string | null>(null);
  // Bumping this re-runs the effect, which is how Retry re-fetches.
  const [reloadToken, setReloadToken] = useState(0);

  const drawerRef = useRef<HTMLDivElement>(null);

  // Dev override short-circuits the network entirely. It participates in the
  // fetch effect (via `overrideState` in the deps of `fetchLedger`) so that
  // toggling it in the parent actually re-renders the requested state.
  const fetchLedger = useCallback(
    (signal: AbortSignal): (() => void) | undefined => {
      if (overrideState === 'loading') {
        setData(null);
        setError(null);
        setIsLoading(true);
        return;
      }
      if (overrideState === 'empty') {
        setData({
          count: 0,
          next: null,
          previous: null,
          tenant: {
            id: tenant.id,
            tenant_id: 0,
            name: tenant.name,
            unit: tenant.unit,
          },
          balance: '0.00',
          transaction_count: 0,
          results: [],
        });
        setError(null);
        setIsLoading(false);
        return;
      }
      if (overrideState === 'error') {
        setData(null);
        setError('Simulated failure (dev override).');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      getLedger(tenant.id, { signal })
        .then((response) => {
          if (signal.aborted) return;
          setData(response);
          setIsLoading(false);
        })
        .catch((err: unknown) => {
          // Ignore our own cancellations.
          if (signal.aborted) return;
          if (err instanceof DOMException && err.name === 'AbortError') return;

          const message =
            err instanceof LedgerApiError
              ? err.detail ?? err.message
              : err instanceof Error
              ? err.message
              : 'Unknown error';
          setError(message);
          setIsLoading(false);
        });
    },
    // `overrideState` is a real dependency now: changing it must re-run the
    // effect so the dev toggle works. tenant.name/unit are used inside the
    // empty override, so they stay too.
    [tenant.id, tenant.name, tenant.unit, overrideState]
  );

  useEffect(() => {
    // AbortController ties the fetch lifetime to this effect. When the
    // component unmounts (or deps change), the request is aborted rather
    // than merely ignored.
    const controller = new AbortController();
    fetchLedger(controller.signal);
    return () => controller.abort();
  }, [fetchLedger, reloadToken]);

  // Close on Escape and lock body scroll while open.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    // Re-entrant scroll lock: remember whether *we* set overflow:hidden, and
    // only restore the value we saved. Nested modals each save their own
    // previous value, so the outermost restore wins.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // Trap focus inside the drawer while it's open.
  useFocusTrap(drawerRef, true);

  const retry = () => setReloadToken((n) => n + 1);

  const displayTenant = data?.tenant.name ?? tenant.name;
  const displayUnit = data?.tenant.unit ?? tenant.unit;

  // A balance is "negative" if it parses to a number below zero. This drives
  // the same visual treatment the transactions get, so a tenant in credit
  // doesn't look like a tenant with a positive balance.
  const balanceValue = data ? Number(data.balance) : NaN;
  const isNegativeBalance = !Number.isNaN(balanceValue) && balanceValue < 0;

  return (
    <div
      className="ledger-overlay"
      // Only close when the click started on the overlay itself, not when a
      // drag began inside the drawer and ended on the overlay.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={drawerRef}
        className="ledger-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Ledger for ${displayTenant}`}
        // The overlay click check above makes stopPropagation unnecessary,
        // but keeping it avoids surprises if a parent adds its own handlers.
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <header className="ledger-drawer__header">
          <div>
            <h2 className="ledger-drawer__title">{displayTenant}</h2>
            <p className="ledger-drawer__subtitle">
              Unit {displayUnit || '—'}
            </p>
          </div>
          <button
            type="button"
            className="ledger-close"
            onClick={onClose}
            aria-label="Close ledger"
          >
            ×
          </button>
        </header>

        <div className="ledger-drawer__body">
          {isLoading && <LedgerSkeleton />}

          {!isLoading && error && (
            <LedgerError message={error} onRetry={retry} />
          )}

          {!isLoading && !error && data && (
            <>
              <div className="ledger-balance">
                <span className="ledger-balance__label">Current balance</span>
                <span
                  className={
                    'ledger-balance__value' +
                    (isNegativeBalance ? ' ledger-amount--negative' : '')
                  }
                >
                  {formatCurrency(data.balance)}
                </span>
              </div>

              {data.results.length === 0 ? (
                <LedgerEmpty />
              ) : (
                <table className="ledger-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Type</th>
                      <th className="ledger-table__amount-col">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.results.map((txn) => {
                      const signed = signedAmount(txn);
                      return (
                        <tr key={txn.id}>
                          <td>{formatDate(txn.date)}</td>
                          <td>{txn.description}</td>
                          <td>
                            <span
                              className={`ledger-type ledger-type--${
                                txn.type ?? 'unknown'
                              }`}
                            >
                              {txn.type ?? '—'}
                            </span>
                          </td>
                          <td
                            className={
                              signed < 0 ? 'ledger-amount--negative' : undefined
                            }
                          >
                            {formatCurrency(signed.toFixed(2))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default LedgerView;