# Currency & Locale Handling in NexCRM

## Model choice: Tenant + Deal-level currency (Option B)

Each tenant has a **`default_currency`** (ISO 4217, e.g. `EUR`, `USD`).
Each deal inherits the tenant currency at creation time and **stores its own `currency` field** for future multi-currency support.
No `value_converted` field exists yet — cross-currency conversion is Phase 2.

---

## Where currency/locale is stored

| Layer           | Field(s)                                    | Source of truth     |
|-----------------|---------------------------------------------|---------------------|
| DB (`tenants`)  | `default_currency`, `locale`, `timezone`    | Migration 005       |
| API response    | `defaultCurrency`, `locale`, `timezone`     | `GET /api/v1/tenant`|
| Frontend        | `TenantContext` → `useTenant()`             | Loaded once on boot |
| Deal graph node | `currency` (defaults to tenant currency)    | `graph-core` deals  |

---

## TenantId sourcing

`tenantId` is **always taken from the verified JWT** — never from a query param sent by the browser.

- The API gateway verifies the JWT and injects `tenantId` into downstream headers/query params.
- The `/api/v1/tenant` endpoint reads `tenantId` from `request.user.tenantId` (JWT claim).
- Graph-core routes receive `tenantId` as a query param injected by the proxy — never from the raw client request.

---

## Frontend usage

```tsx
import { useTenant } from "@/lib/tenant-context";
import { formatCurrency } from "@/lib/utils";

function MyComponent() {
  const { tenant } = useTenant();

  return (
    <span>
      {formatCurrency(deal.value, tenant.defaultCurrency, true, tenant.locale)}
    </span>
  );
}
```

`formatCurrency` signature:
```ts
formatCurrency(value: number, currency?: string, compact?: boolean, locale?: string): string
```

- `currency` defaults to `"USD"` as a last-resort fallback — **always pass `tenant.defaultCurrency`**.
- `locale` defaults to `"en-US"` — pass `tenant.locale` for correct symbol placement (e.g. `"de-DE"` puts `€` after the number).

---

## Forecast gap threshold

The pipeline Kanban flags a "significant gap" between declared and reality forecasts using a **percentage rule**:

```
gap_is_significant = declared > 0 && (gap / declared) × 100 > 15
```

This replaces the old hardcoded `gap > 20_000` which was:
1. USD-specific (wrong for EUR, GBP, JPY, etc.)
2. Not meaningful for large pipelines where a $20 k gap is noise

The threshold (`15 %`) is defined in `GAP_THRESHOLD_PCT` in `pipeline/page.tsx`.

---

## Updating tenant currency (admin only)

```http
PATCH /api/v1/tenant
Authorization: Bearer <token>
Content-Type: application/json

{
  "defaultCurrency": "EUR",
  "locale": "de-DE",
  "timezone": "Europe/Berlin"
}
```

- Requires `admin` or `super_admin` role.
- Returns the updated tenant preferences.
- The Settings → General tab calls this automatically on Save.
- **Does not convert existing deal values** — only new deals created after this change will default to the new currency.

---

## Seed data (development)

The dev seed sets:
- `tenant.default_currency = "EUR"`
- `tenant.locale = "de-DE"`
- `tenant.timezone = "Europe/Berlin"`
- All 3 seed deals use `currency: "EUR"`

This lets you verify the full chain: DB → API → TenantContext → `formatCurrency` → UI.

---

## Adding a new currency

1. Add it to `SUPPORTED_CURRENCIES` in `apps/web/src/app/(dashboard)/settings/page.tsx`.
2. The DB column accepts any valid ISO 4217 code — no migration needed.
3. Ensure `Intl.NumberFormat` supports it (all modern environments do).

---

## Phase 2 — Multi-currency deals

When a tenant operates in multiple currencies, deals will carry individual `currency` fields that may differ from `tenant.defaultCurrency`. A `value_converted` field (in tenant currency) will be added to enable cross-currency pipeline aggregation. The `formatCurrency` + TenantContext approach already supports this transparently.
