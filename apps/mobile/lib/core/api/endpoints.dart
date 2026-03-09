/// API endpoint constants.
///
/// In dev the gateway runs on localhost:4000.
/// For Android emulator, 10.0.2.2 maps to host loopback.
/// Override via --dart-define=API_URL=...
class Endpoints {
  Endpoints._();

  static const String apiUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'http://10.0.2.2:4000',
  );

  static const String authUrl = String.fromEnvironment(
    'AUTH_URL',
    defaultValue: 'http://10.0.2.2:4001',
  );

  // Auth — routed through the API gateway so CORS is handled in one place.
  static String get login => '$apiUrl/auth/login';
  static String get register => '$apiUrl/auth/register';
  static String get refresh => '$apiUrl/auth/refresh';
  static String get forgotPassword => '$apiUrl/auth/forgot-password';
  static String get me => '$apiUrl/auth/me';

  // CRM
  static String get contacts => '$apiUrl/api/v1/contacts';
  static String get companies => '$apiUrl/api/v1/companies';
  static String get deals => '$apiUrl/api/v1/deals';
  static String get activities => '$apiUrl/api/v1/activities';
  static String get tasks => '$apiUrl/api/v1/tasks';
  static String get quotes => '$apiUrl/api/v1/quotes';
  static String get reports => '$apiUrl/api/v1/reports';
  static String get workflows => '$apiUrl/api/v1/workflows';
  static String get users => '$apiUrl/api/v1/users';
  static String get tenant => '$apiUrl/api/v1/tenant';
  static String get integrations => '$apiUrl/api/v1/integrations';

  // Notifications
  static String get notifications => '$apiUrl/api/v1/notifications';

  // Outreach
  static String get sequences => '$apiUrl/api/v1/outreach/sequences';

  // AI
  static String get aiNl => '$apiUrl/api/v1/ai/nl';
  static String get aiReviewQueue => '$apiUrl/api/v1/ai/review-queue';
  static String get aiForecast => '$apiUrl/api/v1/ai/forecast';

  // Reports
  static String get reportsRun => '$apiUrl/api/v1/reports/run';

  // Import / Export
  static String get import_ => '$apiUrl/api/v1/import';
  static String get export_ => '$apiUrl/api/v1/export';

  // Custom fields / objects
  static String get customFields => '$apiUrl/api/v1/custom-fields';
  static String get customObjects => '$apiUrl/api/v1/custom-objects';

  // Permissions
  static String get permissions => '$apiUrl/api/v1/permissions';

  // Products
  static String get products => '$apiUrl/api/v1/products';

  // Billing
  static String get billing => '$apiUrl/api/v1/billing';

  // API Keys
  static String get apiKeys => '$apiUrl/api/v1/api-keys';

  // Bulk
  static String get bulk => '$apiUrl/api/v1/bulk';

  // Leads (contacts with lead stage)
  static String get leads => '$apiUrl/api/v1/contacts';

  // Marketing / Campaigns
  static String get campaigns => '$apiUrl/api/v1/campaigns';
  static String get tags => '$apiUrl/api/v1/tags';
  static String get notes => '$apiUrl/api/v1/notes';

  // Compliance & Data Governance
  static String get compliance => '$apiUrl/api/v1/compliance';
  static String get complianceControls => '$apiUrl/api/v1/compliance/controls';
  static String get complianceEscrow => '$apiUrl/api/v1/compliance/escrow';
  static String get complianceMirroring => '$apiUrl/api/v1/compliance/mirroring';
  static String get complianceRetention => '$apiUrl/api/v1/compliance/retention';

  // Sales Insights
  static String get insights => '$apiUrl/api/v1/insights';
  static String get insightsActivity => '$apiUrl/api/v1/insights/activity';
  static String get insightsEngagement => '$apiUrl/api/v1/insights/engagement';
  static String get insightsPipeline => '$apiUrl/api/v1/insights/pipeline';
  static String get insightsTeam => '$apiUrl/api/v1/insights/team';

  // Calling / Power Dialer
  static String get callingQueue => '$apiUrl/api/calling/queue';
  static String get callingHistory => '$apiUrl/api/calling/history';
  static String get callingDisposition => '$apiUrl/api/calling/disposition';

  // Coaching
  static String get coachingAlerts => '$apiUrl/api/v1/coaching/alerts';
  static String get coachingReps => '$apiUrl/api/v1/coaching/reps';
  static String get coachingSkills => '$apiUrl/api/v1/coaching/skills';
  static String get coachingMeetings => '$apiUrl/api/v1/coaching/meetings';
  static String get coachingRecommendations => '$apiUrl/api/v1/coaching/recommendations';
  static String get coachingMetrics => '$apiUrl/api/v1/coaching/metrics';

  // Forecasting
  static String get forecasting => '$apiUrl/api/v1/forecasting';
  static String get forecastingSummary => '$apiUrl/api/v1/forecasting/summary';
  static String get forecastingCompute => '$apiUrl/api/v1/forecasting/compute';

  // Territories
  static String get territories => '$apiUrl/api/v1/territories';
  static String get territoriesRules => '$apiUrl/api/v1/territories/rules';

  // Lead Scoring
  static String get leadScoring => '$apiUrl/api/v1/lead-scoring';
  static String get leadScoringComputeAll => '$apiUrl/api/v1/lead-scoring/compute-all';

  // Anomalies
  static String get anomalies => '$apiUrl/api/v1/anomalies';
  static String get anomaliesSummary => '$apiUrl/api/v1/anomalies/summary';
  static String get anomaliesScan => '$apiUrl/api/v1/anomalies/scan';

  // Marketplace
  static String get marketplace => '$apiUrl/api/v1/marketplace';
  static String get marketplaceInstalls => '$apiUrl/api/v1/marketplace/installs';
  static String get marketplaceInstall => '$apiUrl/api/v1/marketplace/install';

  // Admin
  static String get adminTenants => '$apiUrl/api/admin/tenants';
  static String get adminStats => '$apiUrl/api/admin/stats/platform';
  static String get adminMerges => '$apiUrl/api/admin/merges';
  static String get adminReportTypes => '$apiUrl/api/v1/admin-reports/types';
  static String get adminReportRun => '$apiUrl/api/v1/admin-reports/run';
  static String get adminDuplicates => '$apiUrl/api/v1/admin/duplicates';
  static String get adminDuplicatesDismiss => '$apiUrl/api/v1/admin/duplicates/dismiss';
  static String get adminDuplicatesMerge => '$apiUrl/api/v1/admin/duplicates/merge';
  static String get adminDuplicatesStats => '$apiUrl/api/v1/admin/duplicates/stats';
}
