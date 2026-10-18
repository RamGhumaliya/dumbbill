/// Request ids made by the app. The twin of `dumbbill-web/src/lib/api/request-id.ts`.
///
/// Every API call carries an `X-Request-Id` header and the server writes the same id on every log line and error of
/// that call. Creating the id here, BEFORE sending, means that even when the network fails and no response ever
/// comes back, the user still has a reference to quote to support.
///
/// Format: 26 characters (ULID style): 10 of time, then 16 random.
library;

import 'dart:math';

const _alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
final _random = Random.secure();

/// A new unique, time-sortable request id. [now] exists so tests can fix the time.
String newRequestId({DateTime? now}) {
  final milliseconds = (now ?? DateTime.now()).millisecondsSinceEpoch;
  final time = StringBuffer();
  var remaining = milliseconds;
  for (var i = 0; i < 10; i++) {
    time.write(_alphabet[remaining % 32]);
    remaining ~/= 32;
  }
  // The time part was written least-significant first, so reverse it to make ids sort by time.
  final timePart = time.toString().split('').reversed.join();
  final randomPart = List.generate(16, (_) => _alphabet[_random.nextInt(32)]).join();
  return '$timePart$randomPart';
}
