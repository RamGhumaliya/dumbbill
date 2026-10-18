/// Builds the one configured [Dio] HTTP client the whole app uses.
library;

import 'package:dio/dio.dart';
import 'package:dumbbill_mobile/core/network/auth_refresher.dart';
import 'package:dumbbill_mobile/core/network/interceptors.dart';
import 'package:dumbbill_mobile/core/network/token_store.dart';

/// Creates the HTTP client: base address, timeouts, JSON, and the three interceptors in the right order.
///
/// Nothing is logged here on purpose: request and response bodies can contain passwords, tokens and customer data.
/// [adapter] exists for tests, which pass a fake instead of the real network.
Dio buildDio({
  required String baseUrl,
  required TokenStore tokenStore,
  required AuthRefresher refresher,
  void Function()? onUnauthenticated,
  HttpClientAdapter? adapter,
  Duration timeout = const Duration(seconds: 15),
}) {
  final dio = Dio(
    BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: timeout,
      sendTimeout: timeout,
      receiveTimeout: timeout,
      headers: {'Accept': 'application/json'},
    ),
  );
  if (adapter != null) dio.httpClientAdapter = adapter;

  dio.interceptors.addAll([
    RequestIdInterceptor(),
    AuthInterceptor(
      tokenStore: tokenStore,
      refresher: refresher,
      dio: () => dio,
      onUnauthenticated: onUnauthenticated,
    ),
    ErrorMapperInterceptor(),
  ]);
  return dio;
}
