import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:flutter_displaymode/flutter_displaymode.dart';
import 'app.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Force highest refresh rate on capable devices (e.g. 120Hz on Galaxy S25)
  try {
    await FlutterDisplayMode.setHighRefreshRate();
  } catch (_) {
    // Not supported on all devices/platforms
  }

  await SentryFlutter.init(
    (options) {
      options.dsn = const String.fromEnvironment(
        'SENTRY_DSN',
        defaultValue: '',
      );
      options.environment = kReleaseMode ? 'production' : 'development';
      options.tracesSampleRate = kReleaseMode ? 0.2 : 1.0;
      options.enableAutoPerformanceTracing = true;
      options.enableUserInteractionTracing = true;
    },
    appRunner: () => runApp(
      DefaultAssetBundle(
        bundle: SentryAssetBundle(),
        child: const ProviderScope(child: NexCRMApp()),
      ),
    ),
  );
}
