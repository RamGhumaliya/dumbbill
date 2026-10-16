# Mobile Manual Test Checklist (emulator / simulator)

Run on: Android emulator (Pixel 6, API 34 and API 26), iOS simulator (iPhone 15 and SE). Both themes, font scale 1.0 and 1.5, slow network (throttled), airplane mode.

## Customer app
- [ ] Register, verify email link, login, wrong password message, lockout after repeated failures
- [ ] Forgot/reset password; old sessions logged out
- [ ] Join shop by QR scan, by code, by link; invalid and expired codes show clear messages
- [ ] Join second shop; points and offers stay separate
- [ ] Membership QR: opens fast, brightness boost, token rotates, works after backgrounding
- [ ] Offers list, expiry labels, empty state, pull to refresh
- [ ] Purchase history, invoice detail, no cost fields anywhere
- [ ] Consent toggles, export data, delete account
- [ ] Offline: cached history visible, banner shown, actions disabled safely
## Owner app
- [ ] Biometric unlock, session expiry, logout
- [ ] Today dashboard numbers match web; margin hidden without permission
- [ ] Branch comparison, alerts, push notification opens the right screen
- [ ] Approve / reject discount request, reason required, result visible on POS
## Both
- [ ] Dark and light theme pixel check against design guide, no raw colors
- [ ] TalkBack / VoiceOver on main flows, 44 px targets
- [ ] Rotate, split screen, low-memory kill and resume
- [ ] No crash in Sentry during the run; no sensitive data in logs
Sign-off: tester ______ date ______ build ______
