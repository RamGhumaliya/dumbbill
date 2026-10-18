import 'package:drift/native.dart';
import 'package:dumbbill_mobile/core/config/app_config.dart';
import 'package:dumbbill_mobile/core/format/money.dart';
import 'package:dumbbill_mobile/core/storage/app_database.dart';
import 'package:flutter_test/flutter_test.dart';

AppConfig parse({
  String environment = 'dev',
  String apiBaseUrl = 'http://10.0.2.2:3000',
  String sentryDsn = '',
}) {
  return AppConfig.parse(
    flavor: AppFlavor.owner,
    environment: environment,
    apiBaseUrl: apiBaseUrl,
    appVersion: 'dev',
    sentryDsn: sentryDsn,
  );
}

void main() {
  group('AppConfig', () {
    test('accepts a complete dev configuration', () {
      final config = parse();
      expect(config.environment, AppEnvironment.dev);
      expect(config.isDev, isTrue);
      expect(config.apiBaseUrl, 'http://10.0.2.2:3000');
      expect(
        config.sentryDsn,
        isNull,
        reason: 'an empty Sentry address switches error tracking off',
      );
    });

    test('removes a trailing slash so paths join cleanly', () {
      expect(parse(apiBaseUrl: 'http://10.0.2.2:3000/').apiBaseUrl, 'http://10.0.2.2:3000');
    });

    test('keeps a Sentry address when given', () {
      expect(
        parse(sentryDsn: ' https://abc@o1.ingest.sentry.io/5 ').sentryDsn,
        'https://abc@o1.ingest.sentry.io/5',
      );
    });

    test('prod must use https', () {
      expect(
        () => parse(environment: 'prod', apiBaseUrl: 'http://api.dumbbill.in'),
        throwsA(
          isA<AppConfigException>().having((e) => e.message, 'message', contains('https in prod')),
        ),
      );
      expect(parse(environment: 'prod', apiBaseUrl: 'https://api.dumbbill.in').isDev, isFalse);
    });

    test('lists EVERY problem at once, and says how to fix it', () {
      expect(
        () => parse(environment: 'staging', apiBaseUrl: 'not a url'),
        throwsA(
          isA<AppConfigException>().having(
            (e) => e.message,
            'message',
            allOf(
              contains('ENV must be'),
              contains('API_BASE_URL'),
              contains('--dart-define-from-file'),
            ),
          ),
        ),
      );
    });

    test('there are only two environments: no staging', () {
      expect(AppEnvironment.values.map((e) => e.name), ['dev', 'prod']);
    });

    test('the two apps have their own display names', () {
      expect(AppFlavor.owner.displayName, 'Dumbbill Owner');
      expect(AppFlavor.customer.displayName, 'Dumbbill');
    });
  });

  group('formatPaise', () {
    test('uses the rupee sign, two decimals and Indian grouping', () {
      expect(formatPaise(489900), '₹4,899.00');
      expect(formatPaise(12450000), '₹1,24,500.00');
      expect(formatPaise(999999900), '₹99,99,999.00');
      expect(formatPaise(5), '₹0.05');
      expect(formatPaise(0), '₹0.00');
    });

    test('shows negative amounts (refunds, discounts) with a minus sign', () {
      expect(formatPaise(-35230), '-₹352.30');
    });

    test('can drop ".00" for whole-rupee totals, but never hides real paise', () {
      expect(formatPaise(669400, trimZeroPaise: true), '₹6,694');
      expect(formatPaise(669430, trimZeroPaise: true), '₹6,694.30');
    });
  });

  group('offline cache database', () {
    late AppDatabase database;

    setUp(() => database = AppDatabase(NativeDatabase.memory()));
    tearDown(() => database.close());

    test('stores and reads an entry', () async {
      await database.putCache('owner.dashboard', '{"sales":1}', now: DateTime.utc(2026, 10, 16));
      final entry = await database.getCache('owner.dashboard');
      expect(entry?.json, '{"sales":1}');
      // The database hands the time back in local time (05:30 in India); it is the same INSTANT, so compare moments.
      expect(entry!.storedAt.isAtSameMomentAs(DateTime.utc(2026, 10, 16)), isTrue);
    });

    test('replaces an entry stored under the same key', () async {
      await database.putCache('k', 'old');
      await database.putCache('k', 'new');
      expect((await database.getCache('k'))?.json, 'new');
    });

    test('returns null for a key that was never stored', () async {
      expect(await database.getCache('missing'), isNull);
    });

    test('clearCache empties everything (used on sign-out)', () async {
      await database.putCache('a', '1');
      await database.putCache('b', '2');
      await database.clearCache();
      expect(await database.getCache('a'), isNull);
      expect(await database.getCache('b'), isNull);
    });
  });
}
