/// Shared value formatters.
///
/// Previously nearly every feature screen carried its own private copy of
/// these (16 compact-currency implementations, 12 date/relative-time helpers,
/// 6 `_getNum` clones, …) with drifting output ("1.5K" vs "1500", "k" vs "K").
/// Screens keep thin private aliases that delegate here so call sites stay
/// stable while the logic lives in one place.
library;

/// Coerce a dynamic JSON value to double (0 when absent/unparseable).
double asDouble(dynamic v) =>
    v is num ? v.toDouble() : double.tryParse(v?.toString() ?? '') ?? 0;

/// Compact currency: $1.2M / $45.3K / $980.
String formatCompactCurrency(num v, {String symbol = '\$'}) {
  if (v >= 1000000) return '$symbol${(v / 1000000).toStringAsFixed(1)}M';
  if (v >= 1000) return '$symbol${(v / 1000).toStringAsFixed(1)}K';
  return '$symbol${v.toStringAsFixed(0)}';
}

/// Compact number: 1.2M / 45.3K / 980.
String formatCompactNumber(num v) {
  if (v >= 1000000) return '${(v / 1000000).toStringAsFixed(1)}M';
  if (v >= 1000) return '${(v / 1000).toStringAsFixed(1)}K';
  return v.toStringAsFixed(0);
}

/// Relative time: "just now", "5m ago", "3h ago", "2d ago", else D/M/Y.
String formatRelativeTime(String? iso, {String fallback = '-'}) {
  if (iso == null || iso.isEmpty) return fallback;
  try {
    final dt = DateTime.parse(iso);
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return formatShortDate(iso, fallback: fallback);
  } catch (_) {
    return fallback;
  }
}

/// Short date: D/M/Y ("-" when absent/unparseable).
String formatShortDate(String? iso, {String fallback = '-'}) {
  if (iso == null || iso.isEmpty) return fallback;
  try {
    final dt = DateTime.parse(iso);
    return '${dt.day}/${dt.month}/${dt.year}';
  } catch (_) {
    return iso;
  }
}

/// Short date + time: D/M/Y HH:mm.
String formatShortDateTime(String? iso, {String fallback = '-'}) {
  if (iso == null || iso.isEmpty) return fallback;
  try {
    final dt = DateTime.parse(iso);
    final hh = dt.hour.toString().padLeft(2, '0');
    final mm = dt.minute.toString().padLeft(2, '0');
    return '${dt.day}/${dt.month}/${dt.year} $hh:$mm';
  } catch (_) {
    return iso;
  }
}

/// camelCase / snake_case → "Title Case" label.
String humanize(String s) {
  return s
      .replaceAllMapped(RegExp(r'([a-z])([A-Z])'), (m) => '${m[1]} ${m[2]}')
      .replaceAll('_', ' ')
      .split(' ')
      .where((w) => w.isNotEmpty)
      .map((w) => w[0].toUpperCase() + w.substring(1))
      .join(' ');
}
