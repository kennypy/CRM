/**
 * Map a CRM entity_type to its graph-core collection path. Leads are Person
 * nodes, same as contacts; extraction results use "person" for the same node
 * type. Previously five call sites carried their own (drifting) copies.
 */

export const ENTITY_COLLECTION: Record<string, string> = {
  contact: "contacts",
  person: "contacts",
  lead: "contacts",
  company: "companies",
  deal: "deals",
};
