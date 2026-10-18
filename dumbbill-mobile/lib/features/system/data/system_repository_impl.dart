/// Implements [SystemRepository] on top of the retrofit API. Maps the wire format (DTO) into the domain type.
library;

import 'package:dumbbill_mobile/core/network/api_call.dart';
import 'package:dumbbill_mobile/features/system/data/api/system_api.dart';
import 'package:dumbbill_mobile/features/system/domain/server_status.dart';

/// The real repository: every call goes through [apiCall] so failures always come out as `ApiError`.
class SystemRepositoryImpl implements SystemRepository {
  /// Creates the repository.
  const SystemRepositoryImpl(this._api);

  final SystemApi _api;

  @override
  Future<ServerStatus> getServerStatus() {
    return apiCall(() async {
      final dto = await _api.getReadiness();
      return ServerStatus(ready: dto.status == 'ok', databaseUp: dto.checks.database == 'up');
    });
  }
}
