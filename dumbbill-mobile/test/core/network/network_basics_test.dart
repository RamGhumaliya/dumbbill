import 'package:dio/dio.dart';
import 'package:dumbbill_mobile/core/network/api_call.dart';
import 'package:dumbbill_mobile/core/network/api_error.dart';
import 'package:dumbbill_mobile/core/network/request_id.dart';
import 'package:dumbbill_mobile/core/network/token_store.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('request ids', () {
    test('are 26 characters, unique, and sort by time', () {
      expect(newRequestId(), matches(RegExp(r'^[0-9A-HJKMNP-TV-Z]{26}$')));
      expect({for (var i = 0; i < 1000; i++) newRequestId()}, hasLength(1000));

      final earlier = newRequestId(now: DateTime.fromMillisecondsSinceEpoch(1000000000000));
      final later = newRequestId(now: DateTime.fromMillisecondsSinceEpoch(2000000000000));
      expect(later.compareTo(earlier), greaterThan(0));
    });
  });

  group('ApiError.fromProblem', () {
    test('reads the standard problem body', () {
      final error = ApiError.fromProblem({
        'type': 't',
        'title': 'Discount exceeds your limit',
        'status': 422,
        'code': 'DISCOUNT_EXCEEDS_LIMIT',
        'detail': 'Maximum allowed is 5%.',
        'requestId': '01JA',
        'errors': [
          {'field': 'discount.value', 'message': 'must not be greater than 5'},
        ],
      })!;
      expect(error.status, 422);
      expect(error.code, 'DISCOUNT_EXCEEDS_LIMIT');
      expect(error.detail, 'Maximum allowed is 5%.');
      expect(error.fieldErrors.single.field, 'discount.value');
      expect(error.isNetwork, isFalse);
      expect(error.isUnauthenticated, isFalse);
    });

    test('returns null for anything that is not the standard format', () {
      expect(ApiError.fromProblem(null), isNull);
      expect(ApiError.fromProblem('text'), isNull);
      expect(ApiError.fromProblem(<String, dynamic>{'status': 500}), isNull);
      expect(
        ApiError.fromProblem({'status': '500', 'code': 'X', 'title': 'T', 'requestId': 'R'}),
        isNull,
        reason: 'status must be a number',
      );
    });
  });

  group('apiCall', () {
    test('unwraps the ApiError the interceptor attached', () async {
      const mapped = ApiError(status: 404, code: 'NOT_FOUND', title: 'Not found', requestId: 'R1');
      await expectLater(
        apiCall<void>(() async {
          throw DioException(
            requestOptions: RequestOptions(path: '/x'),
            error: mapped,
          );
        }),
        throwsA(same(mapped)),
      );
    });

    test('a response that does not parse becomes INVALID_RESPONSE (a bug to report)', () async {
      await expectLater(
        apiCall<void>(() async => throw TypeError()),
        throwsA(isA<ApiError>().having((e) => e.code, 'code', ClientErrorCode.invalidResponse)),
      );
      await expectLater(
        apiCall<void>(() async => throw const FormatException('bad json')),
        throwsA(isA<ApiError>().having((e) => e.code, 'code', ClientErrorCode.invalidResponse)),
      );
    });

    test('a cancellation is passed through untouched', () async {
      await expectLater(
        apiCall<void>(() async {
          throw DioException(
            requestOptions: RequestOptions(path: '/x'),
            type: DioExceptionType.cancel,
          );
        }),
        throwsA(isA<DioException>()),
      );
    });

    test('returns the value when nothing goes wrong', () async {
      expect(await apiCall(() async => 42), 42);
    });
  });

  group('token storage', () {
    setUp(() => FlutterSecureStorage.setMockInitialValues({}));

    test('the refresh token is saved in secure storage and survives a restart', () async {
      await SecureTokenStore().writeRefreshToken('REFRESH-1');
      // A brand-new store (as after the app restarts) still finds it.
      expect(await SecureTokenStore().readRefreshToken(), 'REFRESH-1');
    });

    test('the access token lives in memory only: a new store does not see it', () async {
      final first = SecureTokenStore()..accessToken = 'ACCESS-1';
      expect(first.accessToken, 'ACCESS-1');
      expect(SecureTokenStore().accessToken, isNull);
    });

    test('clear forgets both tokens', () async {
      final store = SecureTokenStore()..accessToken = 'A';
      await store.writeRefreshToken('R');
      await store.clear();
      expect(store.accessToken, isNull);
      expect(await store.readRefreshToken(), isNull);
    });

    test('the in-memory store used by tests behaves the same way', () async {
      final store = InMemoryTokenStore()..accessToken = 'A';
      await store.writeRefreshToken('R');
      await store.clear();
      expect(store.accessToken, isNull);
      expect(await store.readRefreshToken(), isNull);
    });
  });
}
