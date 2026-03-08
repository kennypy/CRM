import 'package:dio/dio.dart';
import '../api/endpoints.dart';
import '../models/user.dart';
import '../models/tenant.dart';
import 'token_storage.dart';

class AuthResult {
  final User user;
  final Tenant? tenant;

  const AuthResult({required this.user, this.tenant});
}

/// Handles login, register, refresh, and logout against the auth service.
class AuthService {
  AuthService._();
  static final AuthService instance = AuthService._();

  final _dio = Dio(BaseOptions(
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 15),
    headers: {'Content-Type': 'application/json'},
  ));

  Future<AuthResult> login({
    required String email,
    required String password,
    required String tenantSlug,
  }) async {
    final response = await _dio.post(Endpoints.login, data: {
      'email': email,
      'password': password,
      'tenantSlug': tenantSlug,
    });

    final data = response.data['data'];
    await TokenStorage.saveTokens(
      accessToken: data['accessToken'],
      refreshToken: data['refreshToken'],
    );

    final user = User.fromJson(data['user']);
    await TokenStorage.saveUserJson(user.toJsonString());

    return AuthResult(
      user: user,
      tenant: data['tenant'] != null ? Tenant.fromJson(data['tenant']) : null,
    );
  }

  Future<AuthResult> register({
    required String tenantName,
    required String tenantSlug,
    required String firstName,
    required String lastName,
    required String email,
    required String password,
  }) async {
    final response = await _dio.post(Endpoints.register, data: {
      'tenantName': tenantName,
      'tenantSlug': tenantSlug,
      'firstName': firstName,
      'lastName': lastName,
      'email': email,
      'password': password,
    });

    final data = response.data['data'];
    await TokenStorage.saveTokens(
      accessToken: data['accessToken'],
      refreshToken: data['refreshToken'],
    );

    final user = User.fromJson(data['user']);
    await TokenStorage.saveUserJson(user.toJsonString());

    return AuthResult(
      user: user,
      tenant: data['tenant'] != null ? Tenant.fromJson(data['tenant']) : null,
    );
  }

  Future<void> logout() async {
    try {
      final token = await TokenStorage.getAccessToken();
      if (token != null) {
        await _dio.post(
          '${Endpoints.authUrl}/auth/logout',
          options: Options(headers: {'Authorization': 'Bearer $token'}),
        );
      }
    } catch (_) {
      // Best-effort
    }
    await TokenStorage.clear();
  }

  Future<User?> getCurrentUser() async {
    final userJson = await TokenStorage.getUserJson();
    if (userJson == null) return null;
    try {
      return User.fromJsonString(userJson);
    } catch (_) {
      return null;
    }
  }

  Future<void> forgotPassword({
    required String email,
    required String tenantSlug,
  }) async {
    await _dio.post(Endpoints.forgotPassword, data: {
      'email': email,
      'tenantSlug': tenantSlug,
    });
  }
}
