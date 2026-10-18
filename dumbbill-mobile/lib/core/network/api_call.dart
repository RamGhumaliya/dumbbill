/// One place that turns any failure of an API call into an [ApiError].
library;

import 'package:dio/dio.dart';
import 'package:dumbbill_mobile/core/network/api_error.dart';
import 'package:dumbbill_mobile/core/network/request_id.dart';

/// Runs an API call and guarantees the only error that comes out is an [ApiError].
///
/// Repositories wrap every call:
///
/// ```dart
/// Future<Thing> load() => apiCall(() => _api.getThing());
/// ```
///
/// - A [DioException] already carries an [ApiError] made by the error interceptor, which is unwrapped.
/// - A response that does not parse into the expected DTO (the server changed shape, or sent garbage) becomes
///   `INVALID_RESPONSE`, a bug to report, instead of a confusing crash deep inside a screen.
Future<T> apiCall<T>(Future<T> Function() call) async {
  try {
    return await call();
  } on DioException catch (error) {
    final inner = error.error;
    if (inner is ApiError) throw inner;
    if (error.type == DioExceptionType.cancel) rethrow;
    throw ApiError(
      status: 0,
      code: ClientErrorCode.networkError,
      title: 'Cannot reach the server',
      requestId: newRequestId(),
    );
    // ignore: avoid_catching_errors, generated JSON parsing code reports a wrong shape as a TypeError.
  } on TypeError {
    throw _invalidResponse();
  } on FormatException {
    throw _invalidResponse();
  }
}

ApiError _invalidResponse() => ApiError(
  status: 0,
  code: ClientErrorCode.invalidResponse,
  title: 'The server answered in an unexpected format',
  requestId: newRequestId(),
);
