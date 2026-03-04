/**
 * NexCRM GraphQL Schema (SDL)
 *
 * Covers the full Phase 1 entity surface: Contacts, Companies, Deals,
 * Activities, Review Queue, and Reality Score.
 *
 * Resolvers call graph-core's REST API so all business logic stays in one
 * place and GraphQL is purely a query surface, not a second data layer.
 */

export const typeDefs = `
  # ── Scalar aliases ──────────────────────────────────────────────────────────
  # JSONB fields (proposedChanges, evidence) are returned as JSON strings.

  # ── Enums ────────────────────────────────────────────────────────────────────
  enum DealStage {
    lead
    qualified
    discovery
    proposal
    negotiation
    closed_won
    closed_lost
  }

  enum Seniority {
    individual_contributor
    manager
    director
    vp
    c_suite
    founder
  }

  enum CompanyTier {
    smb
    mid_market
    enterprise
  }

  enum ReviewStatus {
    pending
    approved
    rejected
    auto_approved
  }

  # ── Shared refs ──────────────────────────────────────────────────────────────
  type CompanyRef {
    id: ID!
    name: String!
    domain: String!
  }

  type DealRef {
    id: ID!
    name: String!
  }

  type UserRef {
    id: ID!
    name: String!
  }

  # ── Core types ───────────────────────────────────────────────────────────────
  type Contact {
    id: ID!
    tenantId: String!
    firstName: String!
    lastName: String!
    fullName: String!
    email: String!
    title: String
    phone: String
    seniority: Seniority
    influenceScore: Float
    lastActivityAt: String
    company: CompanyRef
    createdAt: String!
    updatedAt: String!
  }

  type Company {
    id: ID!
    tenantId: String!
    name: String!
    domain: String!
    industry: String
    tier: CompanyTier
    headcount: Int
    website: String
    country: String
    openDeals: Int
    openDealValue: Float
    createdAt: String!
    updatedAt: String!
  }

  type Deal {
    id: ID!
    tenantId: String!
    name: String!
    stage: DealStage!
    value: Float!
    currency: String!
    closeDate: String
    archetype: String
    isExpansion: Boolean
    declaredProbability: Float
    realityScore: Float
    realityExplanation: String
    riskFlags: [String!]!
    ownerId: String
    company: CompanyRef
    buyingGroupSize: Int
    lastActivityAt: String
    createdAt: String!
    updatedAt: String!
  }

  type Activity {
    id: ID!
    tenantId: String!
    type: String!
    subject: String
    summary: String
    sentiment: Float
    deal: DealRef
    company: CompanyRef
    occurredAt: String!
    autoCapture: Boolean!
    createdAt: String!
  }

  # ── Reality Score ─────────────────────────────────────────────────────────────
  type RealityScoreFactor {
    name: String!
    weight: Float!
    score: Float!
    evidence: String
  }

  type RealityScore {
    score: Float!
    trend: String!
    trendDelta: Float!
    explanation: String!
    factors: [RealityScoreFactor!]!
    lastCalculatedAt: String!
  }

  # ── Review Queue ──────────────────────────────────────────────────────────────
  type ReviewItem {
    id: ID!
    tenantId: String!
    status: ReviewStatus!
    confidence: Float!
    summary: String!
    """JSON string of the proposed graph changes"""
    proposedChanges: String!
    evidence: String
    reviewedAt: String
    createdAt: String!
  }

  # ── Pagination ────────────────────────────────────────────────────────────────
  type Pagination {
    total: Int!
    limit: Int!
    hasMore: Boolean!
  }

  type ContactConnection {
    data: [Contact!]!
    pagination: Pagination!
  }

  type CompanyConnection {
    data: [Company!]!
    pagination: Pagination!
  }

  type DealConnection {
    data: [Deal!]!
    pagination: Pagination!
  }

  type ActivityConnection {
    data: [Activity!]!
    pagination: Pagination!
  }

  # ── Inputs ────────────────────────────────────────────────────────────────────
  input ContactFilter {
    search: String
    companyId: ID
  }

  input DealFilter {
    stage: DealStage
    atRisk: Boolean
  }

  input CreateContactInput {
    firstName: String!
    lastName: String!
    email: String!
    title: String
    phone: String
    seniority: Seniority
    companyId: ID
  }

  input UpdateContactInput {
    firstName: String
    lastName: String
    title: String
    phone: String
    seniority: Seniority
  }

  input CreateDealInput {
    name: String!
    stage: DealStage
    value: Float!
    currency: String
    closeDate: String
    companyId: ID
    ownerId: ID
    archetype: String
    declaredProbability: Float
    isExpansion: Boolean
  }

  input UpdateDealInput {
    name: String
    stage: DealStage
    value: Float
    currency: String
    closeDate: String
    archetype: String
    declaredProbability: Float
    isExpansion: Boolean
  }

  # ── Query ─────────────────────────────────────────────────────────────────────
  type Query {
    contact(id: ID!): Contact
    contacts(filter: ContactFilter, limit: Int): ContactConnection!

    company(id: ID!): Company
    companies(search: String, limit: Int): CompanyConnection!

    deal(id: ID!): Deal
    deals(filter: DealFilter, limit: Int): DealConnection!
    dealRealityScore(id: ID!): RealityScore

    activities(limit: Int): ActivityConnection!

    reviewQueue(status: ReviewStatus, limit: Int): [ReviewItem!]!
  }

  # ── Mutation ──────────────────────────────────────────────────────────────────
  type Mutation {
    createContact(input: CreateContactInput!): Contact
    updateContact(id: ID!, input: UpdateContactInput!): Contact
    deleteContact(id: ID!): Boolean

    createDeal(input: CreateDealInput!): Deal
    updateDeal(id: ID!, input: UpdateDealInput!): Deal
    deleteDeal(id: ID!): Boolean

    approveReviewItem(id: ID!): ReviewItem
    rejectReviewItem(id: ID!, reason: String): ReviewItem
  }
`;
