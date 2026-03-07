import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Secure token storage using OS keychain (Android Keystore / iOS Keychain).
class TokenStorage {
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  static const _accessKey = 'nexcrm_access_token';
  static const _refreshKey = 'nexcrm_refresh_token';
  static const _userKey = 'nexcrm_user_json';

  static Future<String?> getAccessToken() => _storage.read(key: _accessKey);
  static Future<String?> getRefreshToken() => _storage.read(key: _refreshKey);
  static Future<String?> getUserJson() => _storage.read(key: _userKey);

  static Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    await _storage.write(key: _accessKey, value: accessToken);
    await _storage.write(key: _refreshKey, value: refreshToken);
  }

  static Future<void> saveUserJson(String json) =>
      _storage.write(key: _userKey, value: json);

  static Future<void> clear() async {
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
    await _storage.delete(key: _userKey);
  }
}
