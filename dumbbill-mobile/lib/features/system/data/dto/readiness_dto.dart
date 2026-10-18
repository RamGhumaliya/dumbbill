/// Shapes of the "System" endpoints, written from the backend's Swagger manual (http://localhost:3000/docs).
///
/// If the backend changes one of these, parsing fails with a clear `INVALID_RESPONSE` error instead of silently
/// breaking a screen. (The web app has the same shapes in `src/lib/api/schemas/system.ts`.)
library;

import 'package:freezed_annotation/freezed_annotation.dart';

part 'readiness_dto.freezed.dart';
part 'readiness_dto.g.dart';

/// `GET /healthz`: is the server process alive.
@freezed
abstract class LivenessDto with _$LivenessDto {
  /// Creates the DTO.
  const factory LivenessDto({required String status}) = _LivenessDto;

  /// Reads it from the server's JSON.
  factory LivenessDto.fromJson(Map<String, dynamic> json) => _$LivenessDtoFromJson(json);
}

/// The dependency checks inside a readiness answer.
@freezed
abstract class ReadinessChecksDto with _$ReadinessChecksDto {
  /// Creates the DTO.
  const factory ReadinessChecksDto({required String database}) = _ReadinessChecksDto;

  /// Reads it from the server's JSON.
  factory ReadinessChecksDto.fromJson(Map<String, dynamic> json) =>
      _$ReadinessChecksDtoFromJson(json);
}

/// `GET /readyz`: can the server reach its database.
@freezed
abstract class ReadinessDto with _$ReadinessDto {
  /// Creates the DTO.
  const factory ReadinessDto({required String status, required ReadinessChecksDto checks}) =
      _ReadinessDto;

  /// Reads it from the server's JSON.
  factory ReadinessDto.fromJson(Map<String, dynamic> json) => _$ReadinessDtoFromJson(json);
}
