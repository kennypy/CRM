import 'package:dio/dio.dart';
import 'package:sentry_dio/sentry_dio.dart';
import '../auth/token_storage.dart';
import 'endpoints.dart';

/// Singleton Dio client with JWT auth interceptor and automatic token refresh.
class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  late final Dio dio = _createDio();
  bool _isRefreshing = false;

  Dio _createDio() {
    final d = Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
      headers: {'Content-Type': 'application/json'},
    ));

    d.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await TokenStorage.getAccessToken();
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (error, handler) async {
        if (error.response?.statusCode == 401 && !_isRefreshing) {
          _isRefreshing = true;
          try {
            final refreshed = await _tryRefresh();
            if (refreshed) {
              // Retry original request with new token
              final token = await TokenStorage.getAccessToken();
              error.requestOptions.headers['Authorization'] = 'Bearer $token';
              final retryResponse = await d.fetch(error.requestOptions);
              return handler.resolve(retryResponse);
            }
          } finally {
            _isRefreshing = false;
          }
        }
        handler.next(error);
      },
    ));

    // Sentry performance tracing for all HTTP requests
    d.addSentry();

    return d;
  }

  Future<bool> _tryRefresh() async {
    final refreshToken = await TokenStorage.getRefreshToken();
    if (refreshToken == null) return false;

    try {
      final response = await Dio().post(
        Endpoints.refresh,
        data: {'refreshToken': refreshToken},
      );

      if (response.statusCode == 200) {
        final data = response.data['data'];
        await TokenStorage.saveTokens(
          accessToken: data['accessToken'],
          refreshToken: data['refreshToken'],
        );
        return true;
      }
    } catch (_) {
      // Refresh failed
    }

    await TokenStorage.clear();
    return false;
  }
}
