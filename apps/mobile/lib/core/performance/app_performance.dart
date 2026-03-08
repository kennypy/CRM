import 'package:sentry_flutter/sentry_flutter.dart';

/// Lightweight helpers for measuring custom performance transactions.
class AppPerformance {
  AppPerformance._();

  /// Start a custom transaction for measuring a named operation.
  ///
  /// Usage:
  /// ```dart
  /// final tx = AppPerformance.startTransaction('loadContacts', 'api');
  /// await fetchContacts();
  /// await tx.finish(status: const SpanStatus.ok());
  /// ```
  static ISentrySpan startTransaction(String name, String operation) {
    return Sentry.startTransaction(name, operation, bindToScope: true);
  }

  /// Measure an async operation and report it as a Sentry transaction.
  ///
  /// Usage:
  /// ```dart
  /// final contacts = await AppPerformance.measure(
  ///   'loadContacts',
  ///   'api',
  ///   () => apiClient.getContacts(),
  /// );
  /// ```
  static Future<T> measure<T>(
    String name,
    String operation,
    Future<T> Function() fn,
  ) async {
    final transaction = Sentry.startTransaction(name, operation, bindToScope: true);
    try {
      final result = await fn();
      transaction.status = const SpanStatus.ok();
      return result;
    } catch (e) {
      transaction.status = const SpanStatus.internalError();
      transaction.throwable = e;
      rethrow;
    } finally {
      await transaction.finish();
    }
  }
}
