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

const _severityFilters = ['all', 'critical', 'high', 'medium', 'low'];

class AnomaliesScreen extends ConsumerStatefulWidget {
  const AnomaliesScreen({super.key});

  @override
  ConsumerState<AnomaliesScreen> createState() => _AnomaliesScreenState();
}

class _AnomaliesScreenState extends ConsumerState<AnomaliesScreen> {
  List<Map<String, dynamic>> _alerts = [];
  Map<String, int> _summary = {};
  bool _loading = true;
  String? _error;
  String _selectedSeverity = 'all';
  String? _expandedId;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        ApiClient.instance.dio.get(Endpoints.anomalies, queryParameters: {'status': 'open'}),
        ApiClient.instance.dio.get('${Endpoints.anomalies}/summary'),
      ]);

      final alertsRes = results[0];
      final summaryRes = results[1];

      final alertData = alertsRes.data['data'];
      final items = alertData is List
          ? alertData
          : (alertData is Map ? (alertData['items'] ?? alertData['alerts'] ?? []) : []);

      final summaryData = summaryRes.data['data'];
      final summaryMap = summaryData is Map
          ? Map<String, int>.from(summaryData.map((k, v) => MapEntry(k.toString(), (v as num).toInt())))
          : <String, int>{};

      if (mounted) {
        setState(() {
          _alerts = List<Map<String, dynamic>>.from(items);
          _summary = summaryMap;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load anomalies');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> get _filteredAlerts {
    if (_selectedSeverity == 'all') return _alerts;
    return _alerts.where((a) => a['severity'] == _selectedSeverity).toList();
  }

  Future<void> _updateStatus(String id, String status) async {
    try {
      await ApiClient.instance.dio.patch('${Endpoints.anomalies}/$id', data: {'status': status});
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
      appBar: AppBar(title: const Text('Anomalies')),
      body: Column(
        children: [
          // Summary counts
          if (!_loading && _error == null)
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

          // Filter chips
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
                  label: Text(filter == 'all' ? 'All' : filter[0].toUpperCase() + filter.substring(1)),
                  selected: selected,
                  onSelected: (_) => setState(() => _selectedSeverity = filter),
                );
              },
            ),
          ),

          // Content
          Expanded(
            child: _error != null
                ? ErrorView(message: _error!, onRetry: _loadData)
                : _loading
                    ? const Center(child: CircularProgressIndicator())
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
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (context, index) {
                                final alert = filtered[index];
                                return _AnomalyCard(
                                  alert: alert,
                                  isExpanded: _expandedId == alert['id'],
                                  onToggle: () {
                                    setState(() {
                                      _expandedId = _expandedId == alert['id'] ? null : alert['id'];
                                    });
                                  },
                                  onAction: (status) => _updateStatus(alert['id'], status),
                                );
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
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
              style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w500),
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
    final alertType = (alert['alertType'] ?? alert['alert_type'] ?? 'unusual_activity') as String;
    final status = (alert['status'] ?? 'open') as String;
    final color = _severityColors[severity] ?? Colors.grey;
    final icon = _alertTypeIcons[alertType] ?? Icons.warning_amber;
    final title = alert['title'] ?? 'Unknown alert';
    final description = alert['description'] ?? '';
    final evidence = alert['evidence'] is List ? List<Map<String, dynamic>>.from(alert['evidence']) : <Map<String, dynamic>>[];
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
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    _ActionButton(
                      icon: Icons.visibility,
                      label: 'Acknowledge',
                      onTap: () => onAction('acknowledged'),
                    ),
                    const SizedBox(width: 8),
                    _ActionButton(
                      icon: Icons.check_circle_outline,
                      label: 'Resolve',
                      color: Colors.green,
                      onTap: () => onAction('resolved'),
                    ),
                    const SizedBox(width: 8),
                    _ActionButton(
                      icon: Icons.close,
                      label: 'Dismiss',
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
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(6),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: c),
            const SizedBox(width: 4),
            Text(label, style: TextStyle(fontSize: 11, color: c, fontWeight: FontWeight.w500)),
          ],
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
        style: TextStyle(fontSize: 10, color: color, fontWeight: FontWeight.w600),
      ),
    );
  }
}
