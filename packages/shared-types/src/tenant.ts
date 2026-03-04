// Tenant-level preferences exposed by GET /api/v1/tenant

export interface TenantPreferences {
  id:              string;
  name:            string;
  slug:            string;
  /** ISO 4217 currency code that all deals inherit by default (e.g. "EUR", "USD"). */
  defaultCurrency: string;
  /** BCP-47 locale for Intl.NumberFormat / date formatting (e.g. "en-US", "de-DE"). */
  locale:          string;
  /** IANA timezone name (e.g. "Europe/Berlin", "America/New_York"). */
  timezone:        string;
  plan:            "starter" | "growth" | "enterprise";
}

export interface UpdateTenantPreferencesInput {
  defaultCurrency?: string;
  locale?:          string;
  timezone?:        string;
}
