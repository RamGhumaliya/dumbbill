import 'package:dio/dio.dart';
import 'package:dumbbill_mobile/core/network/api_error.dart';
import 'package:dumbbill_mobile/core/network/auth_refresher.dart';
import 'package:dumbbill_mobile/core/network/dio_factory.dart';
import 'package:dumbbill_mobile/core/network/token_store.dart';
import 'package:dumbbill_mobile/features/system/data/api/system_api.dart';
import 'package:dumbbill_mobile/features/system/data/system_repository_impl.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_adapter.dart';

/// The whole data path of a feature, with only the network faked: retrofit API -> Dio (interceptors) -> DTO parsing
/// -> repository -> domain type. This is the pattern every future feature follows.
SystemRepositoryImpl repositoryFor(FakeAdapter adapter) {
  final dio = buildDio(
    baseUrl: 'http://api.test',
    tokenStore: InMemoryTokenStore(),
    refresher: const NoopAuthRefresher(),
    adapter: adapter,
  );
  return SystemRepositoryImpl(SystemApi(dio));
}

void main() {
  test('a ready server with a database is reported as ready', () async {
    final adapter = FakeAdapter([
      jsonResponse({
        'status': 'ok',
        'checks': {'database': 'up'},
      }),
    ]);
    final status = await repositoryFor(adapter).getServerStatus();

    expect(status.ready, isTrue);
    expect(status.databaseUp, isTrue);
    // It asked the right address, publicly (no token), with a request id.
    final sent = adapter.requests.single;
    expect(sent.path, '/readyz');
    expect(sent.headers['Authorization'], isNull);
    expect(sent.headers['X-Request-Id'], isNotNull);
  });

  test('a database that is down is reported as down', () async {
    final adapter = FakeAdapter([
      jsonResponse({
        'status': 'ok',
        'checks': {'database': 'down'},
      }),
    ]);
    final status = await repositoryFor(adapter).getServerStatus();
    expect(status.databaseUp, isFalse);
  });

  test('the standard 503 error becomes an ApiError with the server code and reference', () async {
    final adapter = FakeAdapter([
      jsonResponse(
        problemBody(
          status: 503,
          code: 'NOT_READY',
          title: 'Service not ready',
          requestId: 'SRV-REF-1',
        ),
        status: 503,
        problem: true,
      ),
    ]);
    await expectLater(
      repositoryFor(adapter).getServerStatus(),
      throwsA(
        isA<ApiError>()
            .having((e) => e.code, 'code', 'NOT_READY')
            .having((e) => e.status, 'status', 503)
            .having((e) => e.requestId, 'requestId', 'SRV-REF-1'),
      ),
    );
  });

  test('a server that cannot be reached becomes NETWORK_ERROR', () async {
    final adapter = FakeAdapter([
      DioException(
        requestOptions: RequestOptions(path: '/readyz'),
        type: DioExceptionType.connectionError,
      ),
    ]);
    await expectLater(
      repositoryFor(adapter).getServerStatus(),
      throwsA(isA<ApiError>().having((e) => e.code, 'code', ClientErrorCode.networkError)),
    );
  });

  test(
    'an answer in the wrong shape becomes INVALID_RESPONSE instead of crashing a screen',
    () async {
      final adapter = FakeAdapter([
        jsonResponse({'status': 'ok', 'checks': 'not an object'}),
      ]);
      await expectLater(
        repositoryFor(adapter).getServerStatus(),
        throwsA(isA<ApiError>().having((e) => e.code, 'code', ClientErrorCode.invalidResponse)),
      );
    },
  );
}
