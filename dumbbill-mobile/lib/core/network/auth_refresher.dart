/// Renewing an expired login.
library;

/// Renews the access token using the refresh token. Called by the network layer after a 401.
abstract interface class AuthRefresher {
  /// Tries to get a new access token and store it. Returns true if the login was renewed, false if the user must
  /// sign in again.
  Future<bool> refresh();
}

/// Placeholder until authentication exists (step P1-1, when the server gets its refresh endpoint).
///
/// It reports "could not renew", so a 401 sends the user to sign in again, which is the correct behaviour while
/// there is no refresh yet. The real version will call `POST /v1/auth/refresh` with the refresh token from the
/// `TokenStore`, save the new tokens, and return true.
class NoopAuthRefresher implements AuthRefresher {
  /// Creates the placeholder.
  const NoopAuthRefresher();

  @override
  Future<bool> refresh() async => false;
}
