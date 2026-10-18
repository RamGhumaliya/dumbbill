/// A fake network for tests: answers from a queue instead of really connecting, and records what was sent.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

/// Builds a JSON answer. [problem] switches the content type to `application/problem+json`, as the real server
/// does for every error.
ResponseBody jsonResponse(
  Object body, {
  int status = 200,
  bool problem = false,
  Map<String, String> headers = const {},
}) {
  return ResponseBody.fromString(
    jsonEncode(body),
    status,
    headers: {
      Headers.contentTypeHeader: [if (problem) 'application/problem+json' else 'application/json'],
      for (final entry in headers.entries) entry.key: [entry.value],
    },
  );
}

/// A standard error body, as the Dumbbill API sends it (RFC 9457).
Map<String, Object?> problemBody({
  required int status,
  required String code,
  String title = 'Title',
  String requestId = 'REQ-FROM-SERVER',
  String? detail,
  List<Map<String, String>>? errors,
}) {
  return {
    'type': 'https://api.dumbbill.in/errors/x',
    'title': title,
    'status': status,
    'code': code,
    'requestId': requestId,
    'detail': ?detail,
    'errors': ?errors,
  };
}

/// Answers each request with the next item of its queue of answers:
///   - a [ResponseBody] is returned as the server's answer
///   - a [DioException] is thrown, as when the connection fails
///   - a function is called, for answers that need to wait or inspect the request
class FakeAdapter implements HttpClientAdapter {
  /// Creates the adapter with its queue of answers.
  FakeAdapter(List<Object> answers) : _answers = List.of(answers);

  final List<Object> _answers;

  /// Every request that reached the "network", oldest first.
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    if (_answers.isEmpty) throw StateError('FakeAdapter ran out of answers for ${options.uri}');
    final next = _answers.removeAt(0);
    // A real adapter builds its errors around the request it was sending; do the same so the error knows which
    // request failed (and therefore which request id to quote).
    if (next is DioException) throw next.copyWith(requestOptions: options);
    if (next is Future<ResponseBody> Function(RequestOptions)) return await next(options);
    return next as ResponseBody;
  }

  @override
  void close({bool force = false}) {}
}
