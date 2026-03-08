import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/error_view.dart';
import '../../shared/widgets/empty_state.dart';

class MergesScreen extends ConsumerStatefulWidget {
  const MergesScreen({super.key});

  @override
  ConsumerState<MergesScreen> createState() => _MergesScreenState();
}

class _MergesScreenState extends ConsumerState<MergesScreen> {
  List<Map<String, dynamic>> _merges = [];
  bool _loading = true;
  String? _error;
  String? _statusFilter;

  static const List<_StatusFilterOption> _statusOptions = [
    _StatusFilterOption(null, 'All'),
    _StatusFilterOption('pending', 'Pending'),
    _StatusFilterOption('running', 'Running'),
    _StatusFilterOption('completed', 'Completed'),
    _StatusFilterOption('failed', 'Failed'),
    _StatusFilterOption('cancelled', 'Cancelled'),
  ];

  @override
  void initState() {
    super.initState();
    _loadMerges();
  }

  Future<void> _loadMerges() async {
    setState(() { _loading = true; _error = null; });
    try {
      final params = <String, String>{};
      if (_statusFilter != null) params['status'] = _statusFilter!;
      final res = await ApiClient.instance.dio.get(
        Endpoints.adminMerges,
        queryParameters: params,
      );
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['merges'] ?? []) : []);
      if (mounted) setState(() => _merges = List<Map<String, dynamic>>.from(items));
    } catch (e) {
      if (mounted) setState(() => _error = 'Failed to load merge jobs');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onStatusFilterChanged(String? value) {
    setState(() => _statusFilter = value);
    _loadMerges();
  }

  Future<void> _cancelMerge(String mergeId) async {
    try {
      await ApiClient.instance.dio.post('${Endpoints.adminMerges}/$mergeId/cancel');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Merge cancelled')),
        );
        _loadMerges();
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to cancel merge')),
        );
      }
    }
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'pending': return Colors.blue;
      case 'running': case 'in_progress': return Colors.amber;
      case 'completed': return Colors.green;
      case 'failed': return Colors.red;
      case 'cancelled': return Colors.grey;
      default: return Colors.grey;
    }
  }

  IconData _statusIcon(String status) {
    switch (status.toLowerCase()) {
      case 'pending': return Icons.schedule;
      case 'running': case 'in_progress': return Icons.sync;
      case 'completed': return Icons.check_circle;
      case 'failed': return Icons.error;
      case 'cancelled': return Icons.cancel;
      default: return Icons.help_outline;
    }
  }

  String _formatDate(String? date) {
    if (date == null || date.isEmpty) return '-';
    try {
      final dt = DateTime.parse(date);
      return '${dt.day}/${dt.month}/${dt.year} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return date;
    }
  }

  void _showMergeDetail(Map<String, dynamic> merge) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => _MergeDetailView(merge: merge, onCancel: _cancelMerge)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Workspace Merges'),
            Text('Manage merge jobs',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ],
        ),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadMerges),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: SizedBox(
            height: 44,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              itemCount: _statusOptions.length,
              separatorBuilder: (_, __) => const SizedBox(width: 6),
              itemBuilder: (context, index) {
                final option = _statusOptions[index];
                final isSelected = _statusFilter == option.value;
                final chipColor = option.value != null ? _statusColor(option.value!) : theme.colorScheme.primary;
                return FilterChip(
                  label: Text(option.label),
                  selected: isSelected,
                  onSelected: (_) => _onStatusFilterChanged(option.value),
                  selectedColor: chipColor.withOpacity(0.2),
                  checkmarkColor: chipColor,
                  labelStyle: TextStyle(
                    fontSize: 12,
                    fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                    color: isSelected ? chipColor : null,
                  ),
                  visualDensity: VisualDensity.compact,
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                );
              },
            ),
          ),
        ),
      ),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadMerges)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : _merges.isEmpty
                  ? const EmptyState(
                      icon: Icons.merge,
                      title: 'No Merge Jobs',
                      subtitle: 'Merge jobs will appear here when workspaces are merged',
                    )
                  : RefreshIndicator(
                      onRefresh: _loadMerges,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: _merges.length,
                        itemBuilder: (context, index) => _buildMergeCard(theme, _merges[index]),
                      ),
                    ),
    );
  }

  Widget _buildMergeCard(ThemeData theme, Map<String, dynamic> merge) {
    final status = (merge['status'] ?? 'pending').toString();
    final statusColor = _statusColor(status);
    final sourceName = merge['sourceName'] ?? merge['source_name'] ?? merge['sourceSlug'] ?? '';
    final targetName = merge['targetName'] ?? merge['target_name'] ?? merge['targetSlug'] ?? '';
    final createdAt = merge['createdAt'] ?? merge['created_at'] ?? '';
    final progress = merge['progress'] as num?;

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: InkWell(
        onTap: () => _showMergeDetail(merge),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(_statusIcon(status), size: 18, color: statusColor),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text('$sourceName  ->  $targetName',
                        style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 14),
                        maxLines: 1, overflow: TextOverflow.ellipsis),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: statusColor.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(status.replaceAll('_', ' '),
                        style: TextStyle(fontSize: 11, color: statusColor, fontWeight: FontWeight.w500)),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Icon(Icons.calendar_today, size: 12, color: theme.colorScheme.onSurfaceVariant),
                  const SizedBox(width: 4),
                  Text(_formatDate(createdAt),
                      style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant)),
                  if (progress != null) ...[
                    const Spacer(),
                    SizedBox(
                      width: 80,
                      child: LinearProgressIndicator(
                        value: progress / 100,
                        backgroundColor: statusColor.withOpacity(0.1),
                        valueColor: AlwaysStoppedAnimation<Color>(statusColor),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text('${progress.toInt()}%',
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: statusColor)),
                  ],
                ],
              ),
              // Cancel button for active merges
              if (status == 'pending' || status == 'running' || status == 'in_progress') ...[
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    onPressed: () => _showCancelConfirmation(merge['id']?.toString() ?? ''),
                    icon: const Icon(Icons.cancel_outlined, size: 16),
                    label: const Text('Cancel'),
                    style: TextButton.styleFrom(
                      foregroundColor: Colors.red,
                      visualDensity: VisualDensity.compact,
                      textStyle: const TextStyle(fontSize: 12),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  void _showCancelConfirmation(String mergeId) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel Merge'),
        content: const Text('Are you sure you want to cancel this merge job?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('No')),
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              _cancelMerge(mergeId);
            },
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Yes, Cancel'),
          ),
        ],
      ),
    );
  }
}

class _StatusFilterOption {
  final String? value;
  final String label;
  const _StatusFilterOption(this.value, this.label);
}

/// Detail view for a merge job, pushed as a full page
class _MergeDetailView extends StatefulWidget {
  final Map<String, dynamic> merge;
  final Future<void> Function(String) onCancel;

  const _MergeDetailView({required this.merge, required this.onCancel});

  @override
  State<_MergeDetailView> createState() => _MergeDetailViewState();
}

class _MergeDetailViewState extends State<_MergeDetailView> {
  late Map<String, dynamic> _merge;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _merge = widget.merge;
    _loadDetail();
  }

  Future<void> _loadDetail() async {
    final id = _merge['id']?.toString();
    if (id == null) return;
    setState(() => _loading = true);
    try {
      final res = await ApiClient.instance.dio.get('${Endpoints.adminMerges}/$id');
      if (mounted) setState(() => _merge = res.data['data'] ?? _merge);
    } catch (_) {}
    finally { if (mounted) setState(() => _loading = false); }
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'pending': return Colors.blue;
      case 'running': case 'in_progress': return Colors.amber;
      case 'completed': return Colors.green;
      case 'failed': return Colors.red;
      case 'cancelled': return Colors.grey;
      default: return Colors.grey;
    }
  }

  String _formatDate(String? date) {
    if (date == null || date.isEmpty) return '-';
    try {
      final dt = DateTime.parse(date);
      return '${dt.day}/${dt.month}/${dt.year} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return date;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final status = (_merge['status'] ?? 'pending').toString();
    final statusColor = _statusColor(status);
    final isTerminal = ['completed', 'failed', 'cancelled'].contains(status);
    final stats = _merge['stats'] as Map<String, dynamic>?;
    final summary = _merge['summary'] as Map<String, dynamic>?;
    final errors = _merge['errors'] as List? ?? [];
    final progress = _merge['progress'] as num?;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Merge Details'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadDetail),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadDetail,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  // Header with status
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text('Merge Job',
                                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(
                                  color: statusColor.withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Text(status.replaceAll('_', ' ').toUpperCase(),
                                    style: TextStyle(fontSize: 11, color: statusColor, fontWeight: FontWeight.bold)),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          _DetailRow(label: 'Source', value: _merge['sourceName'] ?? _merge['sourceSlug'] ?? '-'),
                          _DetailRow(label: 'Target', value: _merge['targetName'] ?? _merge['targetSlug'] ?? '-'),
                          _DetailRow(label: 'Created', value: _formatDate(_merge['createdAt'] ?? _merge['created_at'])),
                          if (_merge['completedAt'] != null)
                            _DetailRow(label: 'Completed', value: _formatDate(_merge['completedAt'])),
                          if (progress != null) ...[
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                SizedBox(width: 100, child: Text('Progress',
                                    style: theme.textTheme.bodySmall?.copyWith(
                                        color: theme.colorScheme.onSurfaceVariant))),
                                Expanded(
                                  child: LinearProgressIndicator(
                                    value: progress / 100,
                                    backgroundColor: statusColor.withOpacity(0.1),
                                    valueColor: AlwaysStoppedAnimation<Color>(statusColor),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Text('${progress.toInt()}%',
                                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: statusColor)),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),

                  // Entity counts
                  if (stats != null)
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Entity Counts',
                                style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                            const SizedBox(height: 12),
                            ..._buildEntityCountRows(theme, stats),
                          ],
                        ),
                      ),
                    ),

                  // Completed summary
                  if (status == 'completed' && summary != null) ...[
                    const SizedBox(height: 12),
                    Card(
                      color: Colors.green.withOpacity(0.05),
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                const Icon(Icons.check_circle, size: 18, color: Colors.green),
                                const SizedBox(width: 8),
                                Text('Merge Completed',
                                    style: theme.textTheme.titleSmall?.copyWith(
                                        fontWeight: FontWeight.w600, color: Colors.green.shade700)),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text('${summary['moved'] ?? 0} records moved, '
                                '${summary['merged'] ?? 0} records merged, '
                                '${summary['skipped'] ?? 0} skipped.',
                                style: theme.textTheme.bodySmall?.copyWith(color: Colors.green.shade700)),
                          ],
                        ),
                      ),
                    ),
                  ],

                  // Failed error
                  if (status == 'failed' && _merge['errorMessage'] != null) ...[
                    const SizedBox(height: 12),
                    Card(
                      color: Colors.red.withOpacity(0.05),
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                const Icon(Icons.error, size: 18, color: Colors.red),
                                const SizedBox(width: 8),
                                Text('Merge Failed',
                                    style: theme.textTheme.titleSmall?.copyWith(
                                        fontWeight: FontWeight.w600, color: Colors.red.shade700)),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text(_merge['errorMessage'].toString(),
                                style: theme.textTheme.bodySmall?.copyWith(color: Colors.red.shade700)),
                          ],
                        ),
                      ),
                    ),
                  ],

                  // Errors list
                  if (errors.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Icon(Icons.warning_amber, size: 18, color: Colors.orange.shade700),
                                const SizedBox(width: 8),
                                Text('Errors (${errors.length})',
                                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                              ],
                            ),
                            const SizedBox(height: 8),
                            ...errors.take(20).map((e) => Padding(
                              padding: const EdgeInsets.symmetric(vertical: 2),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Icon(Icons.circle, size: 6, color: Colors.red),
                                  const SizedBox(width: 6),
                                  Expanded(
                                    child: Text(e.toString(),
                                        style: theme.textTheme.bodySmall?.copyWith(
                                            color: theme.colorScheme.onSurfaceVariant)),
                                  ),
                                ],
                              ),
                            )),
                            if (errors.length > 20)
                              Padding(
                                padding: const EdgeInsets.only(top: 4),
                                child: Text('...and ${errors.length - 20} more',
                                    style: theme.textTheme.bodySmall?.copyWith(
                                        fontStyle: FontStyle.italic,
                                        color: theme.colorScheme.onSurfaceVariant)),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ],

                  // Cancel button
                  if (!isTerminal) ...[
                    const SizedBox(height: 20),
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: OutlinedButton.icon(
                        onPressed: () {
                          showDialog(
                            context: context,
                            builder: (ctx) => AlertDialog(
                              title: const Text('Cancel Merge'),
                              content: const Text('Are you sure you want to cancel this merge job?'),
                              actions: [
                                TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('No')),
                                TextButton(
                                  onPressed: () {
                                    Navigator.pop(ctx);
                                    widget.onCancel(_merge['id'].toString()).then((_) {
                                      if (mounted) Navigator.pop(context);
                                    });
                                  },
                                  style: TextButton.styleFrom(foregroundColor: Colors.red),
                                  child: const Text('Yes, Cancel'),
                                ),
                              ],
                            ),
                          );
                        },
                        icon: const Icon(Icons.cancel_outlined),
                        label: const Text('Cancel Merge'),
                        style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
                      ),
                    ),
                  ],
                ],
              ),
            ),
    );
  }

  List<Widget> _buildEntityCountRows(ThemeData theme, Map<String, dynamic> stats) {
    final entityTypes = ['users', 'contacts', 'companies', 'deals', 'sequences', 'customObjects'];
    final rows = <Widget>[];
    for (final key in entityTypes) {
      final val = stats[key];
      if (val is Map) {
        final source = val['source'] ?? 0;
        final target = val['target'] ?? 0;
        final conflicts = val['conflicts'] ?? 0;
        rows.add(Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(
            children: [
              SizedBox(width: 100, child: Text(
                key.replaceAllMapped(RegExp(r'([A-Z])'), (m) => ' ${m[1]}')
                    .split(' ').map((w) => w.isNotEmpty ? '${w[0].toUpperCase()}${w.substring(1)}' : '').join(' '),
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              )),
              Expanded(
                child: Text('$source + $target records',
                    style: theme.textTheme.bodySmall),
              ),
              if (conflicts > 0)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                  decoration: BoxDecoration(
                    color: Colors.orange.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text('$conflicts conflicts',
                      style: const TextStyle(fontSize: 10, color: Colors.orange, fontWeight: FontWeight.w500)),
                ),
            ],
          ),
        ));
      }
    }
    return rows;
  }
}

class _DetailRow extends StatelessWidget {
  final String label;
  final String value;

  const _DetailRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          SizedBox(width: 100, child: Text(label,
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant))),
          Expanded(child: Text(value, style: theme.textTheme.bodyMedium)),
        ],
      ),
    );
  }
}
