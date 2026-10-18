import 'package:dio/dio.dart';
import 'package:dumbbill_mobile/core/network/api_error.dart';
import 'package:dumbbill_mobile/core/network/auth_refresher.dart';
import 'package:dumbbill_mobile/core/network/dio_factory.dart';
import 'package:dumbbill_mobile/core/network/interceptors.dart';
import 'package:dumbbill_mobile/core/network/token_store.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_adapter.dart';

/// A refresher that counts how often it was asked, and answers with a fixed result.
class CountingRefresher implements AuthRefresher {
  CountingRefresher({required this.succeeds, this.delay = Duration.zero});

  final bool succeeds;
  final Duration delay;
  int calls = 0;

  @override
  Future<bool> refresh() async {
    calls++;
    await Future<void>.delayed(delay);
    return succeeds;
  }
}

Dio makeDio(
  FakeAdapter adapter, {
  TokenStore? tokens,
  AuthRefresher? refresher,
  void Function()? onUnauthenticated,
  Duration timeout = const Duration(seconds: 5),
}) {
  return buildDio(
    baseUrl: 'http://api.test',
    tokenStore: tokens ?? InMemoryTokenStore(),
    refresher: refresher ?? const NoopAuthRefresher(),
    adapter: adapter,
    onUnauthenticated: onUnauthenticated,
    timeout: timeout,
  );
}

ResponseBody unauthenticated() =>
    jsonResponse(problemBody(status: 401, code: 'UNAUTHENTICATED'), status: 401, problem: true);

/// The error a failed call carries (the mapper puts an [ApiError] into DioException.error).
Future<ApiError> errorOf(Future<Object?> call) async {
  try {
    await call;
  } on DioException catch (error) {
    return error.error! as ApiError;
  }
  throw StateError('The call was expected to fail');
}

void main() {
  group('request headers', () {
    test('every call carries Accept and a fresh 26-character X-Request-Id', () async {
      final adapter = FakeAdapter([
        jsonResponse({'ok': true}),
      ]);
      await makeDio(adapter).get<dynamic>('/x');

      final headers = adapter.requests.single.headers;
      expect(headers['Accept'], 'application/json');
      expect(headers['X-Request-Id'], matches(RegExp(r'^[0-9A-HJKMNP-TV-Z]{26}$')));
      expect(headers['Authorization'], isNull);
    });

    test('sends the access token as a Bearer header, but not when auth is switched off', () async {
      final tokens = InMemoryTokenStore()..accessToken = 'TOKEN123';
      final adapter = FakeAdapter([jsonResponse({}), jsonResponse({})]);
      final dio = makeDio(adapter, tokens: tokens);

      await dio.get<dynamic>('/private');
      await dio.get<dynamic>('/public', options: Options(extra: {authExtraKey: false}));

      expect(adapter.requests[0].headers['Authorization'], 'Bearer TOKEN123');
      expect(adapter.requests[1].headers['Authorization'], isNull);
    });
  });

  group('failures become ApiError', () {
    test(
      'a standard problem body keeps its code, detail, field errors and the SERVER request id',
      () async {
        final adapter = FakeAdapter([
          jsonResponse(
            problemBody(
              status: 400,
              code: 'VALIDATION_FAILED',
              detail: 'Bad input',
              errors: [
                {'field': 'name', 'message': 'should not be empty'},
              ],
            ),
            status: 400,
            problem: true,
          ),
        ]);
        final error = await errorOf(makeDio(adapter).get<dynamic>('/x'));

        expect(error.status, 400);
        expect(error.code, 'VALIDATION_FAILED');
        expect(error.detail, 'Bad input');
        expect(error.requestId, 'REQ-FROM-SERVER');
        expect(error.fieldErrors.single.field, 'name');
        expect(error.fieldErrors.single.message, 'should not be empty');
      },
    );

    test('an error status without the standard body becomes UNEXPECTED_RESPONSE', () async {
      final adapter = FakeAdapter([
        ResponseBody.fromString(
          '<html>Bad gateway</html>',
          502,
          headers: {
            'x-request-id': ['ECHOED-ID'],
            Headers.contentTypeHeader: ['text/html'],
          },
        ),
      ]);
      final error = await errorOf(makeDio(adapter).get<dynamic>('/x'));

      expect(error.status, 502);
      expect(error.code, ClientErrorCode.unexpectedResponse);
      expect(error.requestId, 'ECHOED-ID');
    });

    test(
      'no connection becomes NETWORK_ERROR (status 0) but still carries a reference to quote',
      () async {
        final adapter = FakeAdapter([
          DioException(
            requestOptions: RequestOptions(path: '/x'),
            type: DioExceptionType.connectionError,
          ),
        ]);
        final error = await errorOf(makeDio(adapter).get<dynamic>('/x'));

        expect(error.code, ClientErrorCode.networkError);
        expect(error.isNetwork, isTrue);
        expect(error.requestId, matches(RegExp(r'^[0-9A-HJKMNP-TV-Z]{26}$')));
        // The reference is the same one that was sent in the header.
        expect(error.requestId, adapter.requests.single.headers['X-Request-Id']);
      },
    );

    test('a slow server becomes TIMEOUT', () async {
      final adapter = FakeAdapter([
        DioException(
          requestOptions: RequestOptions(path: '/x'),
          type: DioExceptionType.receiveTimeout,
        ),
      ]);
      final error = await errorOf(makeDio(adapter).get<dynamic>('/x'));
      expect(error.code, ClientErrorCode.timeout);
      expect(error.isNetwork, isTrue);
    });

    test('a cancellation by the caller is NOT turned into an API error', () async {
      final adapter = FakeAdapter([
        DioException(
          requestOptions: RequestOptions(path: '/x'),
          type: DioExceptionType.cancel,
        ),
      ]);
      await expectLater(
        makeDio(adapter).get<dynamic>('/x'),
        throwsA(isA<DioException>().having((e) => e.type, 'type', DioExceptionType.cancel)),
      );
    });
  });

  group('renewing the login on a 401', () {
    test('refreshes once, then repeats the call and succeeds, with the SAME request id', () async {
      final adapter = FakeAdapter([
        unauthenticated(),
        jsonResponse({'hello': 'again'}),
      ]);
      final refresher = CountingRefresher(succeeds: true);
      final response = await makeDio(adapter, refresher: refresher).get<dynamic>('/x');

      expect(response.data, {'hello': 'again'});
      expect(refresher.calls, 1);
      expect(adapter.requests, hasLength(2));
      // Both attempts show up together in the server logs.
      expect(
        adapter.requests[0].headers['X-Request-Id'],
        adapter.requests[1].headers['X-Request-Id'],
      );
    });

    test(
      'when the refresh fails, tells the app the user is signed out and fails with 401',
      () async {
        var signedOut = 0;
        final adapter = FakeAdapter([unauthenticated()]);
        final error = await errorOf(
          makeDio(
            adapter,
            refresher: CountingRefresher(succeeds: false),
            onUnauthenticated: () => signedOut++,
          ).get<dynamic>('/x'),
        );

        expect(error.code, 'UNAUTHENTICATED');
        expect(error.isUnauthenticated, isTrue);
        expect(signedOut, 1);
      },
    );

    test('never loops: a second 401 after a successful refresh is returned as an error', () async {
      final adapter = FakeAdapter([unauthenticated(), unauthenticated()]);
      final refresher = CountingRefresher(succeeds: true);
      final error = await errorOf(makeDio(adapter, refresher: refresher).get<dynamic>('/x'));

      expect(error.status, 401);
      expect(adapter.requests, hasLength(2));
      expect(refresher.calls, 1);
    });

    test('calls that fail at the same moment share ONE refresh', () async {
      final adapter = FakeAdapter([
        unauthenticated(),
        unauthenticated(),
        jsonResponse({'n': 1}),
        jsonResponse({'n': 2}),
      ]);
      final refresher = CountingRefresher(succeeds: true, delay: const Duration(milliseconds: 30));
      final dio = makeDio(adapter, refresher: refresher);

      await Future.wait([dio.get<dynamic>('/a'), dio.get<dynamic>('/b')]);
      expect(refresher.calls, 1);
    });

    test('public calls (auth switched off) never trigger a refresh', () async {
      final adapter = FakeAdapter([unauthenticated()]);
      final refresher = CountingRefresher(succeeds: true);
      final error = await errorOf(
        makeDio(
          adapter,
          refresher: refresher,
        ).get<dynamic>('/login', options: Options(extra: {authExtraKey: false})),
      );

      expect(error.status, 401);
      expect(refresher.calls, 0);
    });
  });
}
