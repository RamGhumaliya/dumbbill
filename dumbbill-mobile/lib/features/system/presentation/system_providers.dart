/// Providers for the System feature: the API, the repository, and the server-status check screens watch.
library;

import 'package:dumbbill_mobile/core/providers/core_providers.dart';
import 'package:dumbbill_mobile/features/system/data/api/system_api.dart';
import 'package:dumbbill_mobile/features/system/data/system_repository_impl.dart';
import 'package:dumbbill_mobile/features/system/domain/server_status.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'system_providers.g.dart';

/// The retrofit API bound to the shared HTTP client.
@riverpod
SystemApi systemApi(Ref ref) => SystemApi(ref.watch(dioProvider));

/// The repository screens use (the domain interface, so tests can swap it).
@riverpod
SystemRepository systemRepository(Ref ref) => SystemRepositoryImpl(ref.watch(systemApiProvider));

/// "Is the server ready?" As an async value: loading, data, or an `ApiError` the screen can show with its reference.
@riverpod
Future<ServerStatus> serverStatus(Ref ref) => ref.watch(systemRepositoryProvider).getServerStatus();
