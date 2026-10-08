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
function formatCurrency(decimalString: string): string {
  const value = Number(decimalString);
  if (Number.isNaN(value)) {
    return decimalString;
  }
  return currencyFormatter.format(value);
}

/** Signed amount for a transaction: payments count against the balance. */
function signedAmount(txn: Transaction): number {
  const magnitude = Number(txn.amount);
  if (Number.isNaN(magnitude)) {
    return 0;
  }
  return txn.type === 'payment' ? -magnitude : magnitude;
}

// --- Sub-components for each state ---

const LedgerSkeleton: React.FC = () => (
  <div className="ledger-skeleton" aria-busy="true" aria-live="polite">
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

  // Read the override through a ref so it applies synchronously and doesn't
  // require adding it to the fetch effect's dependency list.
  const overrideRef = useRef(overrideState);
  overrideRef.current = overrideState;

  const fetchLedger = useCallback(() => {
    // Dev override short-circuits the network entirely.
    const forced = overrideRef.current;
    if (forced === 'loading') {
      setData(null);
      setError(null);
      setIsLoading(true);
      return;
    }
    if (forced === 'empty') {
      setData({
        count: 0,
        next: null,
        previous: null,
        tenant: { id: tenant.id, tenant_id: 0, name: tenant.name, unit: tenant.unit },
        balance: '0.00',
        transaction_count: 0,
        results: [],
      });
      setError(null);
      setIsLoading(false);
      return;
    }
    if (forced === 'error') {
      setData(null);
      setError('Simulated failure (dev override).');
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getLedger(tenant.id)
      .then((response) => {
        if (cancelled) return;
        setData(response);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof LedgerApiError
            ? err.detail ?? err.message
            : err instanceof Error
            ? err.message
            : 'Unknown error';
        setError(message);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tenant.id, tenant.name, tenant.unit]);

  useEffect(() => {
    const cleanup = fetchLedger();
    return cleanup;
    // reloadToken is intentionally a dependency to drive Retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchLedger, reloadToken]);

  // Close on Escape and lock body scroll while open.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const retry = () => setReloadToken((n) => n + 1);

  const displayTenant = data?.tenant.name ?? tenant.name;
  const displayUnit = data?.tenant.unit ?? tenant.unit;

  return (
    <div className="ledger-overlay" onClick={onClose}>
      <div
        className="ledger-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Ledger for ${displayTenant}`}
        onClick={(e) => e.stopPropagation()}
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
                <span className="ledger-balance__value">
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
