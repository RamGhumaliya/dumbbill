/// What the app knows about the server's health, in the app's own words (not the wire format).
library;

/// The answer to "is the server ready?".
class ServerStatus {
  /// Creates a status.
  const ServerStatus({required this.ready, required this.databaseUp});

  /// True when the server says it can serve requests.
  final bool ready;

  /// True when the server can reach its database.
  final bool databaseUp;
}

/// Asks the server how it is doing. A small interface so screens and tests do not depend on how it is done.
abstract interface class SystemRepository {
  /// Fetches the readiness. Throws an `ApiError` on any failure.
  Future<ServerStatus> getServerStatus();
}
