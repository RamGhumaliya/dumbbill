/// App-wide rules for how providers behave when something fails.
library;

/// Switches OFF Riverpod 3's automatic retry.
///
/// Riverpod 3 retries a failed provider on its own, waiting longer each time. For this product that is the wrong
/// default:
///   - a screen would stay on "Checking..." for many seconds while hidden retries run, instead of telling the user
///     at once that the shop wifi is down;
///   - repeating a request on its own can be dangerous when it creates a bill or takes a payment (the same rule as on
///     the web app: writes are never retried automatically, and retrying a write is always a deliberate decision with
///     an Idempotency-Key).
///
/// So a failed read shows its error immediately (with the reference to quote), and the person chooses "Try again".
/// Pass this to `ProviderScope(retry: noAutomaticRetry)`.
Duration? noAutomaticRetry(int retryCount, Object error) => null;
