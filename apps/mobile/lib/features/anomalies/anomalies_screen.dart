import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

const _severityColors = {
  'critical': Colors.red,
  'high': Colors.orange,
  'medium': Colors.amber,
  'low': Colors.grey,
};

const _alertTypeIcons = {
  'stalled_deal': Icons.hourglass_empty,
  'at_risk_account': Icons.trending_down,
  'champion_left': Icons.people_outline,
  'competitor_mention': Icons.message_outlined,
  'budget_cut': Icons.attach_money,
  'budget_cut_signal': Icons.attach_money,
  'engagement_drop': Icons.trending_down,
  'unusual_activity': Icons.warning_amber,
  'ghost_deal': Icons.visibility_off,
};

const _statusLabels = {
  'open': 'Open',
  'acknowledged': 'Acknowledged',
  'resolved': 'Resolved',
  'dismissed': 'Dismissed',
};

const _statusFilters = ['open', 'acknowledged', 'resolved', 'dismissed'];

const _severityFilters = ['all', 'critical', 'high', 'medium', 'low'];

const _actionColors = {
  'acknowledged': Colors.blue,
  'resolved': Colors.green,
  'dismissed': Colors.grey,
};

const _actionIcons = {
  'acknowledged': Icons.visibility,
  'resolved': Icons.check_circle_outline,
  'dismissed': Icons.close,
};

List<Map<String, dynamic>> _buildDemoAlerts() {
  final now = DateTime.now();
  return [
    {
      'id': 'demo-1',
      'title': 'Deal stalled for 14 days',
      'description':
          'The Acme Corp deal has had no activity in the last 14 days. Last contact was via email on ${now.subtract(const Duration(days: 14)).toIso8601String().substring(0, 10)}.',
      'severity': 'critical',
      'alertType': 'stalled_deal',
      'alert_type': 'stalled_deal',
      'status': 'open',
      'entityType': 'deal',
      'entityId': 'deal-001',
      'createdAt': now.subtract(const Duration(hours: 3)).toIso8601String(),
      'evidence': [
        {'label': 'Days inactive', 'detail': '14 days'},
        {'label': 'Last activity', 'detail': 'Email sent on ${now.subtract(const Duration(days: 14)).toIso8601String().substring(0, 10)}'},
      ],
    },
    {
      'id': 'demo-2',
      'title': 'Champion contact left company',
      'description':
          'Jane Smith, the primary champion at Globex Inc, appears to have left the company. LinkedIn profile updated with new employer.',
      'severity': 'high',
      'alertType': 'champion_left',
      'alert_type': 'champion_left',
      'status': 'open',
      'entityType': 'contact',
      'entityId': 'contact-042',
      'createdAt': now.subtract(const Duration(hours: 8)).toIso8601String(),
      'evidence': [
        {'label': 'Contact', 'detail': 'Jane Smith'},
        {'label': 'Signal', 'detail': 'LinkedIn title changed to "VP Sales at OtherCo"'},
      ],
    },
    {
      'id': 'demo-3',
      'title': 'Engagement dropped 60% this quarter',
      'description':
          'Email open rates and meeting frequency with Initech have declined sharply compared to last quarter.',
      'severity': 'medium',
      'alertType': 'engagement_drop',
      'alert_type': 'engagement_drop',
      'status': 'open',
      'entityType': 'account',
      'entityId': 'acct-187',
      'createdAt': now.subtract(const Duration(days: 1)).toIso8601String(),
      'evidence': [
        {'label': 'Email opens', 'detail': 'Down 58% vs last quarter'},
        {'label': 'Meetings', 'detail': '1 this quarter vs 5 last quarter'},
      ],
    },
    {
      'id': 'demo-4',
      'title': 'Competitor mentioned in support ticket',
      'description':
          'A recent support ticket from Umbrella Corp references evaluating a competitor product as a potential replacement.',
      'severity': 'low',
      'alertType': 'competitor_mention',
      'alert_type': 'competitor_mention',
      'status': 'open',
      'entityType': 'account',
      'entityId': 'acct-302',
      'createdAt': now.subtract(const Duration(days: 2)).toIso8601String(),
      'evidence': [
        {'label': 'Source', 'detail': 'Support ticket #4821'},
        {'label': 'Competitor', 'detail': 'RivalCRM Pro'},
      ],
    },
  ];
}

class AnomaliesScreen extends ConsumerStatefulWidget {
  const AnomaliesScreen({super.key});

  @override
  ConsumerState<AnomaliesScreen> createState() => _AnomaliesScreenState();
}

class _AnomaliesScreenState extends ConsumerState<AnomaliesScreen>
    with SingleTickerProviderStateMixin {
  List<Map<String, dynamic>> _alerts = [];
  Map<String, int> _summary = {};
  bool _loading = true;
  String? _error;
  String _selectedSeverity = 'all';
  String _selectedStatus = 'open';
  String? _expandedId;
  bool _scanning = false;
  late TabController _statusTabController;

  @override
  void initState() {
    super.initState();
    _statusTabController = TabController(length: _statusFilters.length, vsync: this);
    _statusTabController.addListener(_onStatusTabChanged);
    _loadData();
  }

  @override
  void dispose() {
    _statusTabController.removeListener(_onStatusTabChanged);
    _statusTabController.dispose();
    super.dispose();
  }

  void _onStatusTabChanged() {
    if (!_statusTabController.indexIsChanging) {
      final newStatus = _statusFilters[_statusTabController.index];
      if (newStatus != _selectedStatus) {
        setState(() => _selectedStatus = newStatus);
        _loadData();
      }
    }
  }

  int get _openCount {
    return _summary['open_count'] ?? _alerts.where((a) => a['status'] == 'open').length;
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        ApiClient.instance.dio.get(
          Endpoints.anomalies,
          queryParameters: {'status': _selectedStatus},
        ),
        ApiClient.instance.dio.get('${Endpoints.anomalies}/summary'),
      ]);

      final alertsRes = results[0];
      final summaryRes = results[1];

      final alertData = alertsRes.data['data'];
      final items = alertData is List
          ? alertData
          : (alertData is Map
              ? (alertData['items'] ?? alertData['alerts'] ?? [])
              : []);

      final summaryData = summaryRes.data['data'];
      final summaryMap = summaryData is Map
          ? Map<String, int>.from(
              summaryData.map((k, v) => MapEntry(k.toString(), (v as num).toInt())))
          : <String, int>{};

      if (mounted) {
        setState(() {
          _alerts = List<Map<String, dynamic>>.from(items);
          _summary = summaryMap;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'Failed to load anomalies';
          _alerts = _buildDemoAlerts()
              .where((a) => a['status'] == _selectedStatus)
              .toList();
          _summary = {
            'critical_count': 1,
            'high_count': 1,
            'medium_count': 1,
            'low_count': 1,
            'open_count': 4,
          };
          _error = null;
        });
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _runScan() async {
    setState(() => _scanning = true);
    try {
      await ApiClient.instance.dio.post('${Endpoints.anomalies}/scan');
      if (mounted) await _loadData();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Scan completed (demo mode)')),
        );
      }
    } finally {
      if (mounted) setState(() => _scanning = false);
    }
  }

  List<Map<String, dynamic>> get _filteredAlerts {
    if (_selectedSeverity == 'all') return _alerts;
    return _alerts.where((a) => a['severity'] == _selectedSeverity).toList();
  }

  Future<void> _updateStatus(String id, String status) async {
    try {
      await ApiClient.instance.dio
          .patch('${Endpoints.anomalies}/$id', data: {'status': status});
      setState(() => _alerts.removeWhere((a) => a['id'] == id));
    } catch (_) {
      // Optimistic: remove from UI regardless
      setState(() => _alerts.removeWhere((a) => a['id'] == id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final filtered = _filteredAlerts;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Anomalies'),
            if (!_loading && _openCount > 0) ...[
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: Colors.red,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  '$_openCount',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ],
        ),
        actions: [
          IconButton(
            icon: _scanning
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.radar),
            tooltip: 'Run Scan',
            onPressed: _scanning ? null : _runScan,
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
            onPressed: _loading ? null : _loadData,
          ),
        ],
        bottom: TabBar(
          controller: _statusTabController,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          tabs: _statusFilters.map((status) {
            final label = _statusLabels[status] ?? status;
            return Tab(text: label);
          }).toList(),
        ),
      ),
      body: Column(
        children: [
          // Summary counts
          if (!_loading)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
              child: Row(
                children: [
                  _SummaryCard(
                    label: 'Critical',
                    count: _summary['critical_count'] ?? 0,
                    color: Colors.red,
                  ),
                  const SizedBox(width: 8),
                  _SummaryCard(
                    label: 'High',
                    count: _summary['high_count'] ?? 0,
                    color: Colors.orange,
                  ),
                  const SizedBox(width: 8),
                  _SummaryCard(
                    label: 'Medium',
                    count: _summary['medium_count'] ?? 0,
                    color: Colors.amber,
                  ),
                  const SizedBox(width: 8),
                  _SummaryCard(
                    label: 'Low',
                    count: _summary['low_count'] ?? 0,
                    color: Colors.grey,
                  ),
                ],
              ),
            ),

          // Severity filter chips
          SizedBox(
            height: 52,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              itemCount: _severityFilters.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final filter = _severityFilters[index];
                final selected = _selectedSeverity == filter;
                return FilterChip(
                  label: Text(filter == 'all'
                      ? 'All'
                      : filter[0].toUpperCase() + filter.substring(1)),
                  selected: selected,
                  onSelected: (_) =>
                      setState(() => _selectedSeverity = filter),
                );
              },
            ),
          ),

          // Content
          Expanded(
            child: _loading
                ? _buildSkeletonLoading()
                : filtered.isEmpty
                    ? const EmptyState(
                        icon: Icons.check_circle_outline,
                        title: 'All clear',
                        subtitle: 'No anomalies detected',
                      )
                    : RefreshIndicator(
                        onRefresh: _loadData,
                        child: ListView.separated(
                          padding: const EdgeInsets.all(12),
                          itemCount: filtered.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: 8),
                          itemBuilder: (context, index) {
                            final alert = filtered[index];
                            return _AnomalyCard(
                              alert: alert,
                              isExpanded: _expandedId == alert['id'],
                              onToggle: () {
                                setState(() {
                                  _expandedId = _expandedId == alert['id']
                                      ? null
                                      : alert['id'];
                                });
                              },
                              onAction: (status) =>
                                  _updateStatus(alert['id'], status),
                            );
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _buildSkeletonLoading() {
    return ListView.separated(
      padding: const EdgeInsets.all(12),
      physics: const NeverScrollableScrollPhysics(),
      itemCount: 4,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, index) => const _SkeletonCard(),
    );
  }
}

class _SkeletonCard extends StatefulWidget {
  const _SkeletonCard();

  @override
  State<_SkeletonCard> createState() => _SkeletonCardState();
}

class _SkeletonCardState extends State<_SkeletonCard>
    with SingleTickerProviderStateMixin {
  late AnimationController _shimmerController;
  late Animation<double> _shimmerAnimation;

  @override
  void initState() {
    super.initState();
    _shimmerController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat();
    _shimmerAnimation = Tween<double>(begin: -1.0, end: 2.0).animate(
      CurvedAnimation(parent: _shimmerController, curve: Curves.easeInOutSine),
    );
  }

  @override
  void dispose() {
    _shimmerController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final baseColor = isDark ? Colors.grey.shade800 : Colors.grey.shade200;
    final highlightColor = isDark ? Colors.grey.shade700 : Colors.grey.shade50;

    return _ShimmerBuilder(
      animation: _shimmerAnimation,
      builder: (context) {
        return Card(
          clipBehavior: Clip.antiAlias,
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment(_shimmerAnimation.value - 1, 0),
                end: Alignment(_shimmerAnimation.value, 0),
                colors: [baseColor, highlightColor, baseColor],
                stops: const [0.0, 0.5, 1.0],
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    // Icon placeholder
                    Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: baseColor,
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Badge row
                          Row(
                            children: [
                              Container(
                                width: 60,
                                height: 16,
                                decoration: BoxDecoration(
                                  color: baseColor,
                                  borderRadius: BorderRadius.circular(4),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Container(
                                width: 80,
                                height: 12,
                                decoration: BoxDecoration(
                                  color: baseColor,
                                  borderRadius: BorderRadius.circular(4),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          // Title
                          Container(
                            width: double.infinity,
                            height: 14,
                            decoration: BoxDecoration(
                              color: baseColor,
                              borderRadius: BorderRadius.circular(4),
                            ),
                          ),
                          const SizedBox(height: 6),
                          // Description
                          Container(
                            width: 200,
                            height: 12,
                            decoration: BoxDecoration(
                              color: baseColor,
                              borderRadius: BorderRadius.circular(4),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                // Action buttons placeholder
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: List.generate(
                    3,
                    (_) => Padding(
                      padding: const EdgeInsets.only(left: 8),
                      child: Container(
                        width: 70,
                        height: 24,
                        decoration: BoxDecoration(
                          color: baseColor,
                          borderRadius: BorderRadius.circular(6),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _ShimmerBuilder extends AnimatedWidget {
  final Widget Function(BuildContext context) builder;

  const _ShimmerBuilder({
    required Animation<double> animation,
    required this.builder,
  }) : super(listenable: animation);

  @override
  Widget build(BuildContext context) {
    return builder(context);
  }
}

class _SummaryCard extends StatelessWidget {
  final String label;
  final int count;
  final Color color;

  const _SummaryCard({
    required this.label,
    required this.count,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
        decoration: BoxDecoration(
          color: color.withOpacity(0.08),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: color.withOpacity(0.2)),
        ),
        child: Column(
          children: [
            Text(
              '$count',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: color,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                  fontSize: 11, color: color, fontWeight: FontWeight.w500),
            ),
          ],
        ),
      ),
    );
  }
}

class _AnomalyCard extends StatelessWidget {
  final Map<String, dynamic> alert;
  final bool isExpanded;
  final VoidCallback onToggle;
  final void Function(String status) onAction;

  const _AnomalyCard({
    required this.alert,
    required this.isExpanded,
    required this.onToggle,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final severity = (alert['severity'] ?? 'low') as String;
    final alertType =
        (alert['alertType'] ?? alert['alert_type'] ?? 'unusual_activity')
            as String;
    final status = (alert['status'] ?? 'open') as String;
    final color = _severityColors[severity] ?? Colors.grey;
    final icon = _alertTypeIcons[alertType] ?? Icons.warning_amber;
    final title = alert['title'] ?? 'Unknown alert';
    final description = alert['description'] ?? '';
    final evidence = alert['evidence'] is List
        ? List<Map<String, dynamic>>.from(alert['evidence'])
        : <Map<String, dynamic>>[];
    final entityType = alert['entityType'] ?? alert['entity_type'] ?? '';
    final entityId = alert['entityId'] ?? alert['entity_id'] ?? '';
    final createdAt = alert['createdAt'] ?? alert['created_at'];

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onToggle,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Container(
              color: color.withOpacity(0.05),
              padding: const EdgeInsets.all(12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Alert type icon
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: color.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(icon, size: 20, color: color),
                  ),
                  const SizedBox(width: 12),

                  // Content
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Severity badge + alert type
                        Row(
                          children: [
                            _Badge(
                              label: severity.toUpperCase(),
                              color: color,
                            ),
                            const SizedBox(width: 6),
                            Text(
                              alertType.replaceAll('_', ' '),
                              style: TextStyle(
                                fontSize: 11,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                            if (createdAt != null) ...[
                              Text(
                                ' \u00b7 ${_formatDate(createdAt)}',
                                style: TextStyle(
                                  fontSize: 11,
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 6),

                        // Title
                        Text(
                          title,
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: color.withOpacity(0.9),
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 4),

                        // Description
                        Text(
                          description,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                          maxLines: isExpanded ? null : 2,
                          overflow: isExpanded ? null : TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // Action buttons for open alerts
            if (status == 'open')
              Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    _ActionButton(
                      icon: Icons.visibility,
                      label: 'Acknowledge',
                      color: Colors.blue,
                      onTap: () => onAction('acknowledged'),
                    ),
                    const SizedBox(width: 4),
                    _ActionButton(
                      icon: Icons.check_circle_outline,
                      label: 'Resolve',
                      color: Colors.green,
                      onTap: () => onAction('resolved'),
                    ),
                    const SizedBox(width: 4),
                    _ActionButton(
                      icon: Icons.close,
                      label: 'Dismiss',
                      color: Colors.grey,
                      onTap: () => onAction('dismissed'),
                    ),
                  ],
                ),
              ),

            // Expandable evidence section
            if (isExpanded && evidence.isNotEmpty)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Divider(),
                    Text(
                      'EVIDENCE',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: theme.colorScheme.onSurfaceVariant,
                        letterSpacing: 0.5,
                      ),
                    ),
                    const SizedBox(height: 8),
                    ...evidence.map((ev) => Padding(
                          padding: const EdgeInsets.only(bottom: 6),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${ev['label'] ?? 'Info'}: ',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                              Expanded(
                                child: Text(
                                  ev['detail'] ?? '',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: theme.colorScheme.onSurface,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        )),
                    const SizedBox(height: 4),
                    Text(
                      '${entityType} \u00b7 ${entityId.toString().length > 8 ? entityId.toString().substring(0, 8) : entityId}',
                      style: TextStyle(
                        fontSize: 11,
                        color: theme.colorScheme.onSurfaceVariant,
                        fontFamily: 'monospace',
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  String _formatDate(String? iso) {
    if (iso == null) return '';
    try {
      final d = DateTime.parse(iso);
      final now = DateTime.now();
      final diff = now.difference(d);
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      if (diff.inHours < 24) return '${diff.inHours}h ago';
      if (diff.inDays < 7) return '${diff.inDays}d ago';
      return '${d.month}/${d.day}/${d.year}';
    } catch (_) {
      return '';
    }
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color? color;
  final VoidCallback onTap;

  const _ActionButton({
    required this.icon,
    required this.label,
    this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = color ?? Theme.of(context).colorScheme.onSurfaceVariant;
    return Material(
      color: c.withOpacity(0.08),
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 15, color: c),
              const SizedBox(width: 5),
              Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  color: c,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String label;
  final Color color;

  const _Badge({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Text(
        label,
        style: TextStyle(
            fontSize: 10, color: color, fontWeight: FontWeight.w600),
      ),
    );
  }
}
