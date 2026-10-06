# Simulated PMS Integration API

Base URL: `https://kpsaflrfjmhwomxiqrtiplvqem0hfmec.lambda-url.us-east-2.on.aws/api/simulated-pms-integration-api`

## Tenants

Returns tenant records from the property management system.

**Endpoint:** `GET /tenants/`

### Parameters

| Parameter | Description |
|-----------|-------------|
| includeLedgers | When `true`, includes the tenant's ledger in the response. |

### Response

Returns an array of tenant objects.

```json
[
    {
        "tenant_id": 123,
        "name": "Jane Doe",
        "unit": "987",
        "ledger": [...]
    }
]
```

### Tenant Fields

| Field | Description |
|-------|-------------|
| tenant_id | The tenant's identifier in the PMS |
| name | Full name |
| unit | Unit code |

### Ledger Entry Fields

| Field | Description |
|-------|-------------|
| id | Transaction identifier |
| date | Date of the transaction |
| amount | Dollar amount |
| type | Transaction type |
| description | Description of the transaction |
