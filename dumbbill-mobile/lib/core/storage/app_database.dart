/// The phone's local database (SQLite through drift).
///
/// Its job in this app is an OFFLINE CACHE: the last data the server sent (a customer's purchase history, an owner's
/// last dashboard) so a screen can show something useful when the shop's wifi drops. The server is always the source
/// of truth; this cache is disposable and can be emptied at any time without losing anything.
///
/// Never store tokens or passwords here (they go in secure storage, see `core/network/token_store.dart`).
///
/// After changing a table, regenerate the code with `dart run build_runner build` (the `*.g.dart` file is not
/// committed).
library;

import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

part 'app_database.g.dart';

/// One cached server response, stored as JSON text under a key such as `owner.dashboard`.
class CacheEntries extends Table {
  /// What this entry is, for example `customer.history.<shopId>`.
  TextColumn get key => text()();

  /// The cached JSON, exactly as the server sent it.
  TextColumn get json => text()();

  /// When it was stored, so screens can say "as of 5 minutes ago".
  DateTimeColumn get storedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {key};
}

/// The app's database. Create the real one with [AppDatabase.persistent]; tests use an in-memory one.
@DriftDatabase(tables: [CacheEntries])
class AppDatabase extends _$AppDatabase {
  /// Opens the given connection (used by tests with an in-memory database).
  AppDatabase(super.e);

  /// The real, on-disk database in the app's private storage.
  AppDatabase.persistent() : super(driftDatabase(name: 'dumbbill'));

  @override
  int get schemaVersion => 1;

  /// Saves (or replaces) a cache entry.
  Future<void> putCache(String key, String json, {DateTime? now}) {
    return into(cacheEntries).insertOnConflictUpdate(
      CacheEntriesCompanion.insert(key: key, json: json, storedAt: now ?? DateTime.now()),
    );
  }

  /// Reads a cache entry, or null if there is none.
  Future<CacheEntry?> getCache(String key) {
    return (select(cacheEntries)..where((row) => row.key.equals(key))).getSingleOrNull();
  }

  /// Empties the whole cache (used on sign-out: the next person must not see the previous person's data).
  Future<void> clearCache() => delete(cacheEntries).go();
}
