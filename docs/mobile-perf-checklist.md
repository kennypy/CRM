# Mobile Performance Testing Checklist

## Device: Samsung Galaxy S25 (or similar flagship)

### Prerequisites
- Build a release APK: `flutter build apk --release`
- Install on device: `adb install build/app/outputs/flutter-apk/app-release.apk`
- Connect device to same network as API server (or use production API)

### 1. App Startup

| Test | Target | How to Measure |
|------|--------|----------------|
| Cold start to login screen | < 2s | Force stop app → launch → time until login form visible |
| Warm start (resume) | < 500ms | Press home → reopen → time until interactive |

### 2. Authentication Flow

| Test | Target | How to Measure |
|------|--------|----------------|
| Login → dashboard render | < 3s | Tap "Sign in" → time until dashboard KPIs visible |
| Register → dashboard | < 4s | Submit registration → time until dashboard loads |

### 3. List Scrolling (60fps target)

| Test | Target | How to Measure |
|------|--------|----------------|
| Contacts list (100+ items) | 60fps, no jank | Enable performance overlay → scroll quickly |
| Pipeline deals list | 60fps, no jank | Scroll through deal cards rapidly |
| Activities timeline | 60fps, no jank | Scroll through activity feed |

**Enable performance overlay:**
```dart
// In debug mode, toggle via Flutter DevTools
// In profile mode: flutter run --profile
```

### 4. Page Load Times

| Page | Target | How to Measure |
|------|--------|----------------|
| Dashboard | < 2s | Navigate → time until all KPI cards rendered |
| Contacts list | < 2s | Navigate → time until first 20 contacts visible |
| Pipeline board | < 2s | Navigate → time until stage columns visible |
| Company detail | < 1.5s | Tap company → time until detail page rendered |
| Contact detail | < 1.5s | Tap contact → time until detail page rendered |

### 5. Search Responsiveness

| Test | Target |
|------|--------|
| Contacts search (type 3+ chars) | Results appear < 500ms after typing stops |
| Command bar search | Results < 300ms |

### 6. Memory Usage

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Initial memory (after login) | < 80MB | Flutter DevTools → Memory tab |
| After 10 min active use | < 150MB | Navigate between pages, open details, search |
| After background (5 min) | No growth | Check memory doesn't grow when backgrounded |

### 7. Network Performance

| Test | Target |
|------|--------|
| WiFi (local network) | All API calls < 500ms |
| 4G throttled | Page loads < 4s, no timeouts |
| Offline → online recovery | Graceful error → auto-retry when reconnected |

**Throttle network on device:**
Settings → Developer Options → Network speed limit → 4G

### 8. Battery Impact

| Test | Method |
|------|--------|
| 15 min active use | Check battery usage in Settings → Battery |
| Background drain (1 hour) | Should be < 1% battery in background |

### 9. Image/Asset Loading

| Test | Target |
|------|--------|
| Contact avatars (cached) | Instant on repeat visit |
| Company logos | Load < 1s, placeholder shown immediately |
| Charts/graphs on dashboard | Render < 500ms |

### 10. Flutter DevTools Profiling

Run in profile mode for accurate measurements:
```bash
flutter run --profile
```

In Flutter DevTools:
1. **Performance tab**: Check for frames > 16ms (jank indicators)
2. **Memory tab**: Look for memory leaks (growing heap after GC)
3. **Network tab**: Verify API response times
4. **CPU Profiler**: Identify hot paths on main thread

### Results Template

| Test | Target | Actual | Pass/Fail |
|------|--------|--------|-----------|
| Cold start | < 2s | ___ms | |
| Login flow | < 3s | ___ms | |
| Dashboard load | < 2s | ___ms | |
| Contacts scroll | 60fps | ___fps | |
| Pipeline load | < 2s | ___ms | |
| Memory (10 min) | < 150MB | ___MB | |
| 4G page load | < 4s | ___ms | |
