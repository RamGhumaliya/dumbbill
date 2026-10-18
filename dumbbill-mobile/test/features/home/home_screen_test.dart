import 'dart:async';

import 'package:dumbbill_mobile/app/app.dart';
import 'package:dumbbill_mobile/core/config/app_config.dart';
import 'package:dumbbill_mobile/core/network/api_error.dart';
import 'package:dumbbill_mobile/core/providers/core_providers.dart';
import 'package:dumbbill_mobile/core/providers/provider_policy.dart';
import 'package:dumbbill_mobile/core/theme/design_tokens.generated.dart';
import 'package:dumbbill_mobile/features/system/domain/server_status.dart';
import 'package:dumbbill_mobile/features/system/presentation/system_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// A system repository whose answer each test decides, and which counts how often it was asked.
class FakeSystemRepository implements SystemRepository {
  FakeSystemRepository(this._answer);

  final Future<ServerStatus> Function() _answer;
  int calls = 0;

  @override
  Future<ServerStatus> getServerStatus() {
    calls++;
    return _answer();
  }
}

const readyStatus = ServerStatus(ready: true, databaseUp: true);
const networkError = ApiError(
  status: 0,
  code: ClientErrorCode.networkError,
  title: 'Cannot reach the server',
  requestId: '01JTESTREFERENCE000000000',
);

/// Shows the real app (theme, translations, router, providers) with only the server faked.
Future<void> pumpApp(
  WidgetTester tester, {
  required AppFlavor flavor,
  required FakeSystemRepository repository,
}) async {
  // A tall phone-sized screen, so the whole list is on screen (a ListView only builds what is visible).
  tester.view
    ..physicalSize = const Size(1200, 4800)
    ..devicePixelRatio = 3;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ProviderScope(
      retry: noAutomaticRetry,
      overrides: [
        appConfigProvider.overrideWithValue(
          AppConfig(
            flavor: flavor,
            environment: AppEnvironment.dev,
            apiBaseUrl: 'http://10.0.2.2:3000',
            appVersion: 'test',
          ),
        ),
        systemRepositoryProvider.overrideWithValue(repository),
      ],
      child: const DumbbillApp(),
    ),
  );
  await tester.pumpAndSettle();
}

DumbbillColors colorsOf(WidgetTester tester) {
  return Theme.of(tester.element(find.byType(Scaffold))).extension<DumbbillColors>()!;
}

void main() {
  group('owner app', () {
    testWidgets('shows the dashboard preview, labelled as sample data, and a ready server', (
      tester,
    ) async {
      await pumpApp(
        tester,
        flavor: AppFlavor.owner,
        repository: FakeSystemRepository(() async => readyStatus),
      );

      expect(find.text('DUMBBILL OWNER'), findsOneWidget);
      expect(find.text('OWNER DASHBOARD'), findsOneWidget);
      expect(find.text('Sample figures for layout only. Not real data.'), findsOneWidget);
      expect(find.text('₹1,84,260'), findsOneWidget, reason: 'Indian digit grouping');
      expect(find.text('₹38,900'), findsOneWidget);
      expect(find.text('Server is ready'), findsOneWidget);
      expect(find.text('Database connected'), findsOneWidget);
      expect(find.textContaining('http://10.0.2.2:3000'), findsOneWidget);
      // The customer content is not shown in the owner app.
      expect(find.text('YOUR SHOPS'), findsNothing);
    });
  });

  group('customer app', () {
    testWidgets('shows a shop card preview and not the owner dashboard', (tester) async {
      await pumpApp(
        tester,
        flavor: AppFlavor.customer,
        repository: FakeSystemRepository(() async => readyStatus),
      );

      expect(find.text('DUMBBILL'), findsOneWidget);
      expect(find.text('YOUR SHOPS'), findsOneWidget);
      expect(find.text('FitFuel Nutrition, Andheri West'), findsOneWidget);
      expect(find.text('420'), findsOneWidget);
      expect(find.text('worth ₹210'), findsOneWidget);
      expect(find.text('OWNER DASHBOARD'), findsNothing);
    });
  });

  group('server status', () {
    testWidgets('while checking, says so', (tester) async {
      final never = Completer<ServerStatus>();
      await tester.pumpWidget(
        ProviderScope(
          retry: noAutomaticRetry,
          overrides: [
            appConfigProvider.overrideWithValue(
              const AppConfig(
                flavor: AppFlavor.owner,
                environment: AppEnvironment.dev,
                apiBaseUrl: 'http://x',
                appVersion: 't',
              ),
            ),
            systemRepositoryProvider.overrideWithValue(FakeSystemRepository(() => never.future)),
          ],
          child: const DumbbillApp(),
        ),
      );
      await tester.pump();
      expect(find.text('Checking the server'), findsOneWidget);
    });

    testWidgets(
      'an unreachable server is explained in plain words, with the reference, and can be retried',
      (tester) async {
        var healthy = false;
        final repository = FakeSystemRepository(() async {
          if (healthy) return readyStatus;
          throw networkError;
        });
        await pumpApp(tester, flavor: AppFlavor.owner, repository: repository);

        expect(find.text('Cannot reach the server'), findsOneWidget);
        expect(find.text('NETWORK_ERROR'), findsOneWidget);
        expect(find.text('Reference: 01JTESTREFERENCE000000000'), findsOneWidget);
        expect(find.textContaining('Start the API'), findsOneWidget);
        expect(repository.calls, 1);

        healthy = true;
        await tester.tap(find.text('Try again'));
        await tester.pumpAndSettle();

        expect(repository.calls, 2);
        expect(find.text('Server is ready'), findsOneWidget);
        expect(find.text('Try again'), findsNothing);
      },
    );

    testWidgets('a server problem (not a network failure) shows its code and reference', (
      tester,
    ) async {
      const problem = ApiError(
        status: 503,
        code: 'NOT_READY',
        title: 'Service not ready',
        requestId: 'SRV-1',
      );
      await pumpApp(
        tester,
        flavor: AppFlavor.owner,
        repository: FakeSystemRepository(() async => throw problem),
      );

      expect(find.text('The server answered with a problem'), findsOneWidget);
      expect(find.text('NOT_READY'), findsOneWidget);
      expect(find.text('Reference: SRV-1'), findsOneWidget);
      expect(find.textContaining('Start the API'), findsNothing);
    });
  });

  group('themes', () {
    testWidgets('follows the device by default, and the switch moves between dark and light', (
      tester,
    ) async {
      await pumpApp(
        tester,
        flavor: AppFlavor.owner,
        repository: FakeSystemRepository(() async => readyStatus),
      );
      // The test device is light, so "System" shows Quiet Ledger.
      expect(colorsOf(tester), same(DumbbillColors.light));

      await tester.tap(find.text('Dark'));
      await tester.pumpAndSettle();
      expect(colorsOf(tester), same(DumbbillColors.dark));
      expect(tester.widget<Scaffold>(find.byType(Scaffold)).backgroundColor, isNull);
      expect(
        Theme.of(tester.element(find.byType(Scaffold))).scaffoldBackgroundColor,
        DumbbillColors.dark.bgBase,
      );

      await tester.tap(find.text('Light'));
      await tester.pumpAndSettle();
      expect(colorsOf(tester), same(DumbbillColors.light));

      await tester.tap(find.text('System'));
      await tester.pumpAndSettle();
      expect(colorsOf(tester), same(DumbbillColors.light));
    });

    testWidgets('a device in dark mode gets Iron Ledger without the user choosing', (tester) async {
      tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
      addTearDown(tester.platformDispatcher.clearAllTestValues);
      await pumpApp(
        tester,
        flavor: AppFlavor.owner,
        repository: FakeSystemRepository(() async => readyStatus),
      );
      expect(colorsOf(tester), same(DumbbillColors.dark));
    });
  });

  group('prices use the product fonts, with the rupee fallback', () {
    testWidgets('the KPI figures use Barlow Condensed with Inter Tight as the rupee fallback', (
      tester,
    ) async {
      await pumpApp(
        tester,
        flavor: AppFlavor.owner,
        repository: FakeSystemRepository(() async => readyStatus),
      );
      final style = tester.widget<Text>(find.text('₹1,84,260')).style!;
      expect(style.fontFamily, 'BarlowCondensed');
      expect(style.fontFamilyFallback, contains('InterTight'));
    });
  });

  group('accessibility', () {
    for (final (label, tapDark) in [('light', false), ('dark', true)]) {
      testWidgets('the screen meets Flutter accessibility guidelines in the $label theme', (
        tester,
      ) async {
        final handle = tester.ensureSemantics();
        await pumpApp(
          tester,
          flavor: AppFlavor.owner,
          repository: FakeSystemRepository(() async => throw networkError),
        );
        if (tapDark) {
          await tester.tap(find.text('Dark'));
          await tester.pumpAndSettle();
        }

        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      });
    }

    testWidgets('the title is a header and the theme switch has a name for screen readers', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      await pumpApp(
        tester,
        flavor: AppFlavor.owner,
        repository: FakeSystemRepository(() async => readyStatus),
      );
      expect(find.bySemanticsLabel('Colour theme'), findsOneWidget);
      expect(
        tester.getSemantics(find.text('OWNER DASHBOARD')),
        matchesSemantics(isHeader: true, label: 'OWNER DASHBOARD'),
      );
      handle.dispose();
    });
  });
}
