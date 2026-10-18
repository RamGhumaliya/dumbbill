/// How API failures are represented in the app. The twin of `dumbbill-web/src/lib/api/errors.ts`.
///
/// The server answers every failure with the same body (RFC 9457 "problem details", content type
/// `application/problem+json`; every code is listed in `docs/api/error-codes.md`). This turns it into ONE error class so screens
/// deal with a single, predictable shape. Decide behaviour from [ApiError.code], never from the text.
library;

/// One problem with one input field (validation errors).
class FieldError {
  /// Creates a field error.
  const FieldError({required this.field, required this.message});

  /// Dotted path of the field, for example `discount.value`.
  final String field;

  /// What is wrong, in plain English.
  final String message;
}

/// Failures that happen on the user's side of the wire, where the server never produced a code.
abstract final class ClientErrorCode {
  /// No connection, server down, blocked by the system.
  static const networkError = 'NETWORK_ERROR';

  /// No answer in time.
  static const timeout = 'TIMEOUT';

  /// The server answered, but not in the shape the API manual promises (a bug to report).
  static const invalidResponse = 'INVALID_RESPONSE';

  /// An error status without the standard error body (for example from a proxy).
  static const unexpectedResponse = 'UNEXPECTED_RESPONSE';
}

/// A failed API call. Always carries a [requestId] the user can quote to support.
class ApiError implements Exception {
  /// Creates an error.
  const ApiError({
    required this.status,
    required this.code,
    required this.title,
    required this.requestId,
    this.detail,
    this.fieldErrors = const [],
  });

  /// Builds an error from a decoded problem body, or returns null when the body is not the standard format.
  static ApiError? fromProblem(Object? body) {
    if (body is! Map<String, dynamic>) return null;
    final status = body['status'];
    final code = body['code'];
    final title = body['title'];
    final requestId = body['requestId'];
    if (status is! int || code is! String || title is! String || requestId is! String) return null;

    final errors = body['errors'];
    return ApiError(
      status: status,
      code: code,
      title: title,
      requestId: requestId,
      detail: body['detail'] is String ? body['detail'] as String : null,
      fieldErrors: errors is List
          ? [
              for (final item in errors)
                if (item is Map<String, dynamic> &&
                    item['field'] is String &&
                    item['message'] is String)
                  FieldError(field: item['field'] as String, message: item['message'] as String),
            ]
          : const [],
    );
  }

  /// HTTP status, or 0 when no response was received.
  final int status;

  /// Server error code (see docs/api/error-codes.md) or a [ClientErrorCode].
  final String code;

  /// Short title from the server, or a generic one for client-side failures.
  final String title;

  /// The reference to show the user and quote to support. Always present.
  final String requestId;

  /// Explanation from the server that is safe to show to the user.
  final String? detail;

  /// Per-field problems, for forms.
  final List<FieldError> fieldErrors;

  /// True when the user must sign in again (401).
  bool get isUnauthenticated => status == 401;

  /// True for connection problems, where trying again later may work.
  bool get isNetwork => status == 0;

  @override
  String toString() => 'ApiError($status $code, ref $requestId)';
}
