/// The app-wide building blocks, available to every feature through Riverpod.
///
/// Riverpod is how the app wires things together: a screen asks for what it needs (`ref.watch(dioProvider)`), and
/// tests can swap any of them for a fake with `ProviderScope(overrides: [...])`. Nothing is a global variable.
library;

import 'package:dio/dio.dart';
import 'package:dumbbill_mobile/core/config/app_config.dart';
import 'package:dumbbill_mobile/core/network/auth_refresher.dart';
import 'package:dumbbill_mobile/core/network/dio_factory.dart';
import 'package:dumbbill_mobile/core/network/token_store.dart';
import 'package:dumbbill_mobile/core/storage/app_database.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'core_providers.g.dart';

/// The validated settings. Provided by `bootstrap()` when the app starts; asking for it before then is a bug.
@Riverpod(keepAlive: true)
AppConfig appConfig(Ref ref) {
  throw UnimplementedError(
    'appConfigProvider must be overridden in ProviderScope (see bootstrap.dart).',
  );
}

/// Where the login tokens live (secure storage on the phone).
@Riverpod(keepAlive: true)
TokenStore tokenStore(Ref ref) => SecureTokenStore();

/// Renews an expired login. A placeholder until authentication exists (P1-1).
@Riverpod(keepAlive: true)
AuthRefresher authRefresher(Ref ref) => const NoopAuthRefresher();

/// The one configured HTTP client.
@Riverpod(keepAlive: true)
Dio dio(Ref ref) {
  final config = ref.watch(appConfigProvider);
  return buildDio(
    baseUrl: config.apiBaseUrl,
    tokenStore: ref.watch(tokenStoreProvider),
    refresher: ref.watch(authRefresherProvider),
  );
}

/// The local offline cache database. Closed automatically when the app provider scope is disposed.
@Riverpod(keepAlive: true)
AppDatabase appDatabase(Ref ref) {
  final database = AppDatabase.persistent();
  ref.onDispose(database.close);
  return database;
}
