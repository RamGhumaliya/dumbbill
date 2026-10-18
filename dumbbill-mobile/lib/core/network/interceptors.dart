/// The interceptors every API call goes through. They handle what every call needs, so individual endpoint
/// definitions (see `features/*/data/api`) stay tiny. The twin of `dumbbill-web/src/lib/api/client.ts`.
///
/// Order matters (Dio runs error handling in the order interceptors were added):
///   1. [RequestIdInterceptor]  stamps an id on the request
///   2. [AuthInterceptor]       sends the token; on a 401 renews the login ONCE and repeats the call
///   3. [ErrorMapperInterceptor] turns every failure into an [ApiError]
///
/// Nothing here retries a request on its own: repeating a call that creates a bill is dangerous unless it carries an
/// Idempotency-Key, and that decision belongs to the caller. The one exception is the single repeat after a successful
/// login renewal, which is safe because the first attempt was rejected before doing anything.
library;

import 'dart:async';

import 'package:dio/dio.dart';
import 'package:dumbbill_mobile/core/network/api_error.dart';
import 'package:dumbbill_mobile/core/network/auth_refresher.dart';
import 'package:dumbbill_mobile/core/network/request_id.dart';
import 'package:dumbbill_mobile/core/network/token_store.dart';

/// Put `extra: {authExtraKey: false}` on a call that must not send a token (login, health checks).
const authExtraKey = 'auth';

const _retriedExtraKey = 'authRetried';
const _requestIdExtraKey = 'requestId';

/// Adds a fresh `X-Request-Id` to every call, and remembers it so an error can still quote it if no response arrives.
class RequestIdInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    // A retry after a login renewal keeps the same id, so both attempts appear together in the server logs.
    final id = options.extra[_requestIdExtraKey] as String? ?? newRequestId();
    options.extra[_requestIdExtraKey] = id;
    options.headers['X-Request-Id'] = id;
    handler.next(options);
  }
}

/// Sends the access token, and on a 401 renews the login once.
class AuthInterceptor extends Interceptor {
  /// Creates the interceptor. [dio] is needed to repeat a call after a renewal.
  AuthInterceptor({
    required this.tokenStore,
    required this.refresher,
    required Dio Function() dio,
    this.onUnauthenticated,
  }) : _dio = dio;

  /// Where the access token comes from.
  final TokenStore tokenStore;

  /// Renews the login.
  final AuthRefresher refresher;

  /// Called when the user is definitely signed out, so the app can show the login screen.
  final void Function()? onUnauthenticated;

  final Dio Function() _dio;

  // If several calls get a 401 together, they should share ONE renewal, not start many.
  Future<bool>? _refreshInFlight;

  Future<bool> _refreshOnce() {
    return _refreshInFlight ??= refresher.refresh().whenComplete(() => _refreshInFlight = null);
  }

  bool _usesAuth(RequestOptions options) => options.extra[authExtraKey] != false;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final token = tokenStore.accessToken;
    if (_usesAuth(options) && token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final options = err.requestOptions;
    final isFirst401 =
        err.response?.statusCode == 401 &&
        _usesAuth(options) &&
        options.extra[_retriedExtraKey] != true;
    if (!isFirst401) return handler.next(err);

    if (await _refreshOnce()) {
      try {
        options.extra[_retriedExtraKey] = true; // never loop: a second 401 is returned as an error
        final response = await _dio().fetch<dynamic>(options);
        return handler.resolve(response);
      } on DioException catch (retryError) {
        return handler.next(retryError);
      }
    }
    onUnauthenticated?.call();
    return handler.next(err);
  }
}

/// Converts every Dio failure into an [ApiError] (stored in `DioException.error`), so the rest of the app only
/// ever sees one kind of error.
class ErrorMapperInterceptor extends Interceptor {
  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    // The caller cancelled on purpose: not an API failure.
    if (err.type == DioExceptionType.cancel) return handler.next(err);

    final requestId =
        err.response?.headers.value('x-request-id') ??
        err.requestOptions.extra[_requestIdExtraKey] as String? ??
        'unknown';

    final ApiError mapped;
    final response = err.response;
    if (response != null) {
      mapped =
          ApiError.fromProblem(response.data) ??
          ApiError(
            status: response.statusCode ?? 0,
            code: ClientErrorCode.unexpectedResponse,
            title: 'The server answered ${response.statusCode}',
            requestId: requestId,
          );
    } else if (err.type == DioExceptionType.connectionTimeout ||
        err.type == DioExceptionType.sendTimeout ||
        err.type == DioExceptionType.receiveTimeout) {
      mapped = ApiError(
        status: 0,
        code: ClientErrorCode.timeout,
        title: 'The server took too long to answer',
        requestId: requestId,
      );
    } else {
      mapped = ApiError(
        status: 0,
        code: ClientErrorCode.networkError,
        title: 'Cannot reach the server',
        requestId: requestId,
      );
    }

    handler.next(
      DioException(
        requestOptions: err.requestOptions,
        response: err.response,
        type: err.type,
        error: mapped,
        stackTrace: err.stackTrace,
      ),
    );
  }
}
