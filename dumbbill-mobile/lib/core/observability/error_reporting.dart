/// Error tracking with Sentry. OFF unless a Sentry address is configured.
///
/// With no `SENTRY_DSN` nothing is sent anywhere (development, tests). When it is set, only UNEXPECTED errors are
/// reported (crashes and bugs). Normal failures such as "no connection" or "invalid field" are not errors in our system
/// and would only add noise. Reports never carry customer or secret data: automatic personal data is off and
/// anything that looks like a request body is stripped before sending.
library;

import 'dart:async';

import 'package:dumbbill_mobile/core/config/app_config.dart';
import 'package:flutter/foundation.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

/// Runs [startApp] with crash reporting around it.
///
/// Without a Sentry address the app still gets safe global error handlers (errors are printed in debug builds, never
/// swallowed silently) but nothing leaves the phone.
Future<void> runWithErrorReporting(AppConfig config, FutureOr<void> Function() startApp) async {
  final dsn = config.sentryDsn;
  if (dsn == null) {
    FlutterError.onError = (details) {
      FlutterError.presentError(details);
    };
    await startApp();
    return;
  }

  await SentryFlutter.init((options) {
    options
      ..dsn = dsn
      ..environment = config.environment.name
      ..release = config.appVersion
      // Never attach IP addresses or other automatic personal data.
      ..sendDefaultPii = false
      // Errors only. No performance tracing and no screenshots (a screenshot could show a customer's data).
      ..tracesSampleRate = 0
      ..attachScreenshot = false
      ..beforeSend = _stripPrivateData;
  }, appRunner: startApp);
}

/// Removes anything that could carry customer or secret data from a report before it leaves the phone.
FutureOr<SentryEvent?> _stripPrivateData(SentryEvent event, Hint hint) {
  // The device model and OS stay (needed to diagnose a crash); anything about the person or their requests goes.
  return event
    ..user = null
    ..request = null
    ..breadcrumbs = event.breadcrumbs?.where((crumb) => crumb.category != 'http').toList();
}

/// Reports an unexpected error that was caught and handled (so the app did not crash), tagged with the request
/// reference when there is one. Does nothing when Sentry is off.
Future<void> reportError(Object error, StackTrace stackTrace, {String? requestId}) async {
  if (!Sentry.isEnabled) return;
  await Sentry.captureException(
    error,
    stackTrace: stackTrace,
    withScope: (scope) {
      if (requestId != null) unawaited(scope.setTag('requestId', requestId));
    },
  );
}

/// True when Sentry is active. Used by the start-up code and tests.
bool get isErrorReportingEnabled => Sentry.isEnabled;
