/// Screen navigation (go_router).
library;

import 'package:dumbbill_mobile/features/home/presentation/home_screen.dart';
import 'package:go_router/go_router.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'app_router.g.dart';

/// Address of the home screen.
const homeRoute = '/';

/// The app's router. Every screen is an address, so deep links, the back button and later the login redirect
/// ("not signed in? go to /login") all work the same way.
///
/// Only the home placeholder exists today. Login, shops, offers and the owner screens are added with their features.
@Riverpod(keepAlive: true)
GoRouter appRouter(Ref ref) {
  return GoRouter(
    initialLocation: homeRoute,
    routes: [GoRoute(path: homeRoute, builder: (context, state) => const HomeScreen())],
  );
}
