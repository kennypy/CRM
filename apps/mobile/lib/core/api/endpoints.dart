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

  // Auth
  static String get login => '$authUrl/auth/login';
  static String get register => '$authUrl/auth/register';
  static String get refresh => '$authUrl/auth/refresh';
  static String get forgotPassword => '$authUrl/auth/forgot-password';
  static String get me => '$authUrl/auth/me';

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

  // Outreach
  static String get sequences => '$apiUrl/api/v1/outreach/sequences';

  // AI
  static String get aiNl => '$apiUrl/api/v1/ai/nl';
  static String get aiReviewQueue => '$apiUrl/api/v1/ai/review-queue';

  // Admin reports
  static String get adminReportTypes => '$apiUrl/api/v1/admin-reports/types';
  static String get adminReportRun => '$apiUrl/api/v1/admin-reports/run';
}
