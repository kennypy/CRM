import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/user.dart';
import 'auth_service.dart';
import 'token_storage.dart';

enum AuthStatus { unknown, authenticated, unauthenticated }

class AuthState {
  final AuthStatus status;
  final User? user;
  final String? error;

  const AuthState({
    this.status = AuthStatus.unknown,
    this.user,
    this.error,
  });

  AuthState copyWith({AuthStatus? status, User? user, String? error}) =>
      AuthState(
        status: status ?? this.status,
        user: user ?? this.user,
        error: error,
      );
}

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier() : super(const AuthState()) {
    _checkExistingSession();
  }

  final _authService = AuthService.instance;

  Future<void> _checkExistingSession() async {
    final token = await TokenStorage.getAccessToken();
    if (token == null) {
      state = state.copyWith(status: AuthStatus.unauthenticated);
      return;
    }

    final user = await _authService.getCurrentUser();
    if (user != null) {
      state = state.copyWith(status: AuthStatus.authenticated, user: user);
    } else {
      state = state.copyWith(status: AuthStatus.unauthenticated);
    }
  }

  Future<void> login({
    required String email,
    required String password,
    required String tenantSlug,
  }) async {
    state = state.copyWith(error: null);
    try {
      final result = await _authService.login(
        email: email,
        password: password,
        tenantSlug: tenantSlug,
      );
      state = state.copyWith(
        status: AuthStatus.authenticated,
        user: result.user,
      );
    } catch (e) {
      final message = _extractError(e);
      state = state.copyWith(
        status: AuthStatus.unauthenticated,
        error: message,
      );
      rethrow;
    }
  }

  Future<void> register({
    required String tenantName,
    required String tenantSlug,
    required String firstName,
    required String lastName,
    required String email,
    required String password,
  }) async {
    state = state.copyWith(error: null);
    try {
      final result = await _authService.register(
        tenantName: tenantName,
        tenantSlug: tenantSlug,
        firstName: firstName,
        lastName: lastName,
        email: email,
        password: password,
      );
      state = state.copyWith(
        status: AuthStatus.authenticated,
        user: result.user,
      );
    } catch (e) {
      final message = _extractError(e);
      state = state.copyWith(
        status: AuthStatus.unauthenticated,
        error: message,
      );
      rethrow;
    }
  }

  Future<void> logout() async {
    await _authService.logout();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  String _extractError(dynamic e) {
    if (e is Exception) {
      try {
        final dioErr = e as dynamic;
        final data = dioErr.response?.data;
        if (data is Map && data['error'] is Map) {
          return data['error']['message'] ?? 'An error occurred';
        }
      } catch (_) {}
    }
    return 'An error occurred. Please try again.';
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>(
  (ref) => AuthNotifier(),
);
