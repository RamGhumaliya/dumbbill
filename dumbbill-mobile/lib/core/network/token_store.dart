/// Where the login tokens live on the phone.
///
/// Security decision (same as the web app): the short-lived ACCESS token is kept only in memory and is gone when the
/// app closes. The longer-lived REFRESH token is kept in the system's secure storage (Android Keystore / iOS
/// Keychain), encrypted and unreadable by other apps. After the app restarts, the refresh token is used to get a
/// new access token. Tokens are never written to plain preferences, files or logs.
library;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Holds the current login tokens. Replaceable in tests with [InMemoryTokenStore].
abstract interface class TokenStore {
  /// The current access token, or null when signed out.
  String? get accessToken;

  /// Remembers a new access token (memory only).
  set accessToken(String? value);

  /// Reads the refresh token from secure storage.
  Future<String?> readRefreshToken();

  /// Saves the refresh token in secure storage.
  Future<void> writeRefreshToken(String token);

  /// Forgets everything: used on sign-out and when the login can no longer be renewed.
  Future<void> clear();
}

/// The real store: access token in memory, refresh token in the system's secure storage.
class SecureTokenStore implements TokenStore {
  /// Creates the store. [storage] can be replaced in tests.
  SecureTokenStore({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  static const _refreshKey = 'dumbbill.refresh_token';

  final FlutterSecureStorage _storage;

  @override
  String? accessToken;

  @override
  Future<String?> readRefreshToken() => _storage.read(key: _refreshKey);

  @override
  Future<void> writeRefreshToken(String token) => _storage.write(key: _refreshKey, value: token);

  @override
  Future<void> clear() async {
    accessToken = null;
    await _storage.delete(key: _refreshKey);
  }
}

/// A store that keeps everything in memory. For tests only: it is not secure and forgets on restart.
class InMemoryTokenStore implements TokenStore {
  String? _refresh;

  @override
  String? accessToken;

  @override
  Future<String?> readRefreshToken() async => _refresh;

  @override
  Future<void> writeRefreshToken(String token) async => _refresh = token;

  @override
  Future<void> clear() async {
    accessToken = null;
    _refresh = null;
  }
}
