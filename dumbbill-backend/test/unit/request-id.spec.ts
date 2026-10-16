import { newRequestId, resolveRequestId } from '../../src/common/request-context/request-id';

/** The request id is how a user's error report is matched to the logs, so it must be unique, sortable and safe. */
describe('request ids', () => {
  it('creates 26-character ULID-style ids', () => {
    expect(newRequestId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('creates different ids every time', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newRequestId()));
    expect(ids.size).toBe(1000);
  });

  it('sorts by time: a later request has a larger id', () => {
    expect(newRequestId(2_000_000_000_000) > newRequestId(1_000_000_000_000)).toBe(true);
  });

  describe('resolveRequestId (an id sent by the caller)', () => {
    it('reuses a safe id so one id can follow a request across systems', () => {
      expect(resolveRequestId('web-7f3a9c2e-1234')).toBe('web-7f3a9c2e-1234');
    });

    it.each([
      ['too short', 'abc'],
      ['too long', 'a'.repeat(65)],
      ['spaces', 'has some spaces here'],
      ['log-injection attempt', 'abc12345\nfake log line'],
      ['markup', '<script>alert(1)</script>'],
      ['empty', ''],
    ])('replaces an unsafe id (%s) with a fresh one', (_name, bad) => {
      const id = resolveRequestId(bad);
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    });

    it('creates an id when none was sent, and uses the first when a header was repeated', () => {
      expect(resolveRequestId(undefined)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(resolveRequestId(['first-valid-id', 'second-valid-id'])).toBe('first-valid-id');
    });
  });
});
