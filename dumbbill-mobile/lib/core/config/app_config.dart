/// What kind of app this is and where it talks to: the settings read once at start-up.
library;

/// The two apps built from this one codebase. Each has its own entrypoint (`main_owner.dart`,
/// `main_customer.dart`), its own Android application id, and can be installed side by side.
enum AppFlavor {
  /// The shop owner's app: dashboards, stock alerts, approvals.
  owner('Dumbbill Owner'),

  /// The shopper's loyalty app: join shops, offers, points, membership QR.
  customer('Dumbbill');

  const AppFlavor(this.displayName);

  /// The name shown in the system (matches the name under the icon on Android).
  final String displayName;
}

/// The only two environments that exist. There is no staging.
enum AppEnvironment {
  /// A developer's machine: points at the API on the same computer, shows "(dev)" in the app name.
  dev,

  /// The live product.
  prod,
}

/// Thrown when the build-time settings are missing or wrong. A developer mistake (a forgotten
/// `--dart-define-from-file`), so it is reported plainly at start-up instead of crashing later.
class AppConfigException implements Exception {
  /// Creates the exception with a readable [message].
  const AppConfigException(this.message);

  /// What is wrong and how to fix it.
  final String message;

  @override
  String toString() => message;
}

/// The validated settings of the running app.
///
/// Values arrive at BUILD time through `--dart-define-from-file=config/dev.json` (or `prod.json`), so they are
/// baked into the app and visible to anyone who unpacks it: **never put a secret here**.
class AppConfig {
  /// Creates a config. Prefer [AppConfig.fromEnvironment] in the real app.
  const AppConfig({
    required this.flavor,
    required this.environment,
    required this.apiBaseUrl,
    required this.appVersion,
    this.sentryDsn,
  });

  /// Reads the build-time settings. Throws an [AppConfigException] listing every problem, so a missing or
  /// malformed value stops the app at start instead of failing later in front of a customer.
  factory AppConfig.fromEnvironment(AppFlavor flavor) {
    return AppConfig.parse(
      flavor: flavor,
      environment: const String.fromEnvironment('ENV'),
      apiBaseUrl: const String.fromEnvironment('API_BASE_URL'),
      appVersion: const String.fromEnvironment('APP_VERSION', defaultValue: 'dev'),
      // ignore: avoid_redundant_argument_values, the analyzer sees the empty default; the real value comes from the build.
      sentryDsn: const String.fromEnvironment('SENTRY_DSN'),
    );
  }

  /// Checks raw values and builds a config. Exposed separately so tests can try bad values.
  factory AppConfig.parse({
    required AppFlavor flavor,
    required String environment,
    required String apiBaseUrl,
    required String appVersion,
    String sentryDsn = '',
  }) {
    final problems = <String>[];

    final env = AppEnvironment.values.where((e) => e.name == environment).firstOrNull;
    if (env == null) problems.add('ENV must be "dev" or "prod" (got "$environment").');

    final api = Uri.tryParse(apiBaseUrl);
    if (api == null ||
        !api.hasScheme ||
        !(api.scheme == 'http' || api.scheme == 'https') ||
        api.host.isEmpty) {
      problems.add('API_BASE_URL must be a full http(s) address (got "$apiBaseUrl").');
    } else if (env == AppEnvironment.prod && api.scheme != 'https') {
      problems.add('API_BASE_URL must use https in prod (got "$apiBaseUrl").');
    }

    if (problems.isNotEmpty) {
      throw AppConfigException(
        'Invalid app configuration:\n${problems.map((p) => '  - $p').join('\n')}\n'
        'Run with --dart-define-from-file=config/dev.json (see config/README.md).',
      );
    }

    return AppConfig(
      flavor: flavor,
      environment: env!,
      // No trailing slash, so paths such as "/readyz" join cleanly.
      apiBaseUrl: apiBaseUrl.endsWith('/')
          ? apiBaseUrl.substring(0, apiBaseUrl.length - 1)
          : apiBaseUrl,
      appVersion: appVersion,
      sentryDsn: sentryDsn.trim().isEmpty ? null : sentryDsn.trim(),
    );
  }

  /// Which of the two apps this is.
  final AppFlavor flavor;

  /// `dev` or `prod`.
  final AppEnvironment environment;

  /// Address of the Dumbbill API without a trailing slash. From the Android emulator, the computer is 10.0.2.2.
  final String apiBaseUrl;

  /// Release name written on error reports.
  final String appVersion;

  /// Sentry project address, or null to switch error tracking off (nothing is sent anywhere).
  final String? sentryDsn;

  /// True for developer builds.
  bool get isDev => environment == AppEnvironment.dev;
}
