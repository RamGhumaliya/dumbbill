import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale) : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate = _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[Locale('en')];

  /// No description provided for @themeLabel.
  ///
  /// In en, this message translates to:
  /// **'Colour theme'**
  String get themeLabel;

  /// No description provided for @themeSystem.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get themeSystem;

  /// No description provided for @themeDark.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get themeDark;

  /// No description provided for @themeLight.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get themeLight;

  /// Shown with an error so the person can quote it to support.
  ///
  /// In en, this message translates to:
  /// **'Reference: {code}'**
  String referenceLabel(String code);

  /// No description provided for @ownerTitle.
  ///
  /// In en, this message translates to:
  /// **'Owner dashboard'**
  String get ownerTitle;

  /// No description provided for @ownerSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Sales, stock and profit across your branches will appear here.'**
  String get ownerSubtitle;

  /// No description provided for @ownerSampleHeading.
  ///
  /// In en, this message translates to:
  /// **'Preview of the dashboard'**
  String get ownerSampleHeading;

  /// No description provided for @sampleNotice.
  ///
  /// In en, this message translates to:
  /// **'Sample figures for layout only. Not real data.'**
  String get sampleNotice;

  /// No description provided for @ownerSampleSales.
  ///
  /// In en, this message translates to:
  /// **'Sales today'**
  String get ownerSampleSales;

  /// No description provided for @ownerSampleBills.
  ///
  /// In en, this message translates to:
  /// **'Bills'**
  String get ownerSampleBills;

  /// No description provided for @ownerSampleProfit.
  ///
  /// In en, this message translates to:
  /// **'Gross profit'**
  String get ownerSampleProfit;

  /// No description provided for @ownerSampleLowStock.
  ///
  /// In en, this message translates to:
  /// **'Low stock'**
  String get ownerSampleLowStock;

  /// No description provided for @customerTitle.
  ///
  /// In en, this message translates to:
  /// **'Your shops'**
  String get customerTitle;

  /// No description provided for @customerSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Join a shop with its code or QR to collect points and see its offers.'**
  String get customerSubtitle;

  /// No description provided for @customerSampleHeading.
  ///
  /// In en, this message translates to:
  /// **'Preview of a shop card'**
  String get customerSampleHeading;

  /// No description provided for @customerSampleShop.
  ///
  /// In en, this message translates to:
  /// **'FitFuel Nutrition, Andheri West'**
  String get customerSampleShop;

  /// No description provided for @customerSamplePointsLabel.
  ///
  /// In en, this message translates to:
  /// **'points'**
  String get customerSamplePointsLabel;

  /// No description provided for @customerSamplePointsWorth.
  ///
  /// In en, this message translates to:
  /// **'worth {amount}'**
  String customerSamplePointsWorth(String amount);

  /// No description provided for @customerSampleOffer.
  ///
  /// In en, this message translates to:
  /// **'₹150 off creatine on orders above ₹1,499'**
  String get customerSampleOffer;

  /// No description provided for @customerSampleOfferExpiry.
  ///
  /// In en, this message translates to:
  /// **'Expires 31 Oct'**
  String get customerSampleOfferExpiry;

  /// No description provided for @statusHeading.
  ///
  /// In en, this message translates to:
  /// **'System status'**
  String get statusHeading;

  /// No description provided for @statusChecking.
  ///
  /// In en, this message translates to:
  /// **'Checking the server'**
  String get statusChecking;

  /// No description provided for @statusReady.
  ///
  /// In en, this message translates to:
  /// **'Server is ready'**
  String get statusReady;

  /// No description provided for @statusDatabaseUp.
  ///
  /// In en, this message translates to:
  /// **'Database connected'**
  String get statusDatabaseUp;

  /// No description provided for @statusDatabaseDown.
  ///
  /// In en, this message translates to:
  /// **'Database not reachable'**
  String get statusDatabaseDown;

  /// No description provided for @statusUnreachable.
  ///
  /// In en, this message translates to:
  /// **'Cannot reach the server'**
  String get statusUnreachable;

  /// No description provided for @statusUnreachableHint.
  ///
  /// In en, this message translates to:
  /// **'Start the API (see the dumbbill-backend README) and try again.'**
  String get statusUnreachableHint;

  /// No description provided for @statusProblem.
  ///
  /// In en, this message translates to:
  /// **'The server answered with a problem'**
  String get statusProblem;

  /// No description provided for @statusApiAddress.
  ///
  /// In en, this message translates to:
  /// **'API address'**
  String get statusApiAddress;

  /// No description provided for @tryAgain.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get tryAgain;
}

class _AppLocalizationsDelegate extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) => <String>['en'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
