import React, { useEffect, useState } from 'react';
import LedgerView from './components/LedgerView';

// Dev-only toggle so each ledger UI state can be reviewed without editing code.
// Options map 1:1 to LedgerStateOverride; "live" hits the real API.
const DEV_STATE_OPTIONS = [
    { value: null, label: 'Live (real API)' },
    { value: 'loading', label: 'Force: Loading' },
    { value: 'empty', label: 'Force: Empty' },
    { value: 'error', label: 'Force: Error' },
];

function TenantList() {
    const [tenants, setTenants] = useState([]);
    const [error, setError] = useState(null);
    const [selectedTenant, setSelectedTenant] = useState(null);
    const [devState, setDevState] = useState(null);

    useEffect(() => {
        fetch('/api/tenants/')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => setTenants(data))
            .catch(error => {
                console.error("Error fetching tenants:", error);
                setError(error);
            });
    }, []);

    if (error) {
        return <div>Error loading tenants: {error.message}</div>;
    }

    return (
        <div className="tenant-list">
            <h2>Tenants</h2>

            {process.env.NODE_ENV !== 'production' && (
                <div className="dev-state-toggle">
                    <label htmlFor="ledger-dev-state">Ledger state (dev): </label>
                    <select
                        id="ledger-dev-state"
                        value={devState === null ? 'live' : devState}
                        onChange={e => {
                            const value = e.target.value;
                            setDevState(value === 'live' ? null : value);
                        }}
                    >
                        {DEV_STATE_OPTIONS.map(opt => (
                            <option
                                key={opt.value === null ? 'live' : opt.value}
                                value={opt.value === null ? 'live' : opt.value}
                            >
                                {opt.label}
                            </option>
                        ))}
                    </select>
                    <span className="dev-state-toggle__hint">
                        Open any ledger to preview that state.
                    </span>
                </div>
            )}

            {tenants.length === 0 ? (
                <p>No tenants found.</p>
            ) : (
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
                        {tenants.map(tenant => (
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
            )}

            {selectedTenant && (
                <LedgerView
                    key={selectedTenant.id}
                    tenant={selectedTenant}
                    overrideState={devState}
                    onClose={() => setSelectedTenant(null)}
                />
            )}
        </div>
    );
}

export default TenantList; 