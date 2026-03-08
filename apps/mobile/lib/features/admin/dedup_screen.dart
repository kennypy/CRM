import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/error_view.dart';
import '../../shared/widgets/empty_state.dart';

class DedupScreen extends ConsumerStatefulWidget {
  const DedupScreen({super.key});

  @override
  ConsumerState<DedupScreen> createState() => _DedupScreenState();
}

class _DedupScreenState extends ConsumerState<DedupScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;

  // Data
  List<Map<String, dynamic>> _pairs = [];
  Map<String, dynamic>? _stats;
  final Set<String> _dismissed = {};

  // State
  bool _loading = false;
  bool _scanned = false;
  String? _error;
  String _entityType = 'contact';

  // Pagination
  int _currentPage = 1;
  static const int _pageSize = 20;
  int _total = 0;
  int get _totalPages => (_total / _pageSize).ceil().clamp(1, 9999);

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(() {
      if (!_tabController.indexIsChanging) {
        setState(() {
          _entityType = _tabController.index == 0 ? 'contact' : 'company';
          _scanned = false;
          _pairs = [];
          _stats = null;
          _currentPage = 1;
          _total = 0;
        });
      }
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _scan() async {
    setState(() { _loading = true; _error = null; });
    try {
      final params = <String, String>{
        'entity_type': _entityType,
        'limit': '$_pageSize',
        'page': '$_currentPage',
      };
      final res = await ApiClient.instance.dio.get(
        Endpoints.adminDuplicates,
        queryParameters: params,
      );
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['pairs'] ?? []) : []);
      if (mounted) {
        setState(() {
          _pairs = List<Map<String, dynamic>>.from(items);
          _scanned = true;
          if (data is Map && data['total'] != null) {
            _total = data['total'] is int ? data['total'] : int.tryParse(data['total'].toString()) ?? 0;
          } else if (data is List) {
            _total = data.length;
          }
        });
      }
      _loadStats();
    } catch (e) {
      if (mounted) setState(() => _error = 'Failed to scan for duplicates');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadStats() async {
    try {
      final res = await ApiClient.instance.dio.get(
        Endpoints.adminDuplicatesStats,
        queryParameters: {'entity_type': _entityType},
      );
      if (mounted) setState(() => _stats = res.data['data']);
    } catch (_) {}
  }

  Future<void> _dismiss(Map<String, dynamic> pair) async {
    final ids = [pair['id1']?.toString() ?? '', pair['id2']?.toString() ?? ''];
    ids.sort();
    final key = ids.join(':');
    setState(() => _dismissed.add(key));
    try {
      await ApiClient.instance.dio.post(Endpoints.adminDuplicatesDismiss, data: {
        'id1': pair['id1'],
        'id2': pair['id2'],
        'entity_type': _entityType,
      });
    } catch (_) {}
  }

  Future<void> _executeMerge(Map<String, dynamic> pair, Map<String, String> fieldChoices) async {
    try {
      await ApiClient.instance.dio.post(Endpoints.adminDuplicatesMerge, data: {
        'id1': pair['id1'],
        'id2': pair['id2'],
        'entity_type': _entityType,
        'field_choices': fieldChoices,
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Records merged successfully')),
        );
        _scan();
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to merge records')),
        );
      }
    }
  }

  void _goToPage(int page) {
    if (page < 1 || page > _totalPages || page == _currentPage) return;
    setState(() => _currentPage = page);
    _scan();
  }

  String _pairKey(Map<String, dynamic> pair) {
    final ids = [pair['id1']?.toString() ?? '', pair['id2']?.toString() ?? ''];
    ids.sort();
    return ids.join(':');
  }

  Color _confidenceColor(num confidence) {
    if (confidence >= 90) return Colors.green;
    if (confidence >= 70) return Colors.orange;
    return Colors.red;
  }

  void _showMergePreview(Map<String, dynamic> pair) {
    final fields = _entityType == 'contact'
        ? ['firstName', 'lastName', 'email', 'phone', 'title', 'company', 'source']
        : ['name', 'domain', 'industry', 'phone', 'city', 'country', 'employeeCount'];

    // Build field data from pair
    final record1 = <String, String>{};
    final record2 = <String, String>{};
    for (final field in fields) {
      record1[field] = (pair['record1']?[field] ?? pair['${field}1'] ?? '').toString();
      record2[field] = (pair['record2']?[field] ?? pair['${field}2'] ?? '').toString();
    }

    // Default: pick record1 values
    final choices = <String, String>{};
    for (final field in fields) {
      choices[field] = 'record1';
    }

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.75,
          maxChildSize: 0.95,
          minChildSize: 0.4,
          builder: (ctx, scrollController) => Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(child: Text('Merge Preview',
                        style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold))),
                    IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
                  ],
                ),
                const SizedBox(height: 4),
                Text('Select which value to keep for each field',
                    style: Theme.of(ctx).textTheme.bodySmall?.copyWith(
                        color: Theme.of(ctx).colorScheme.onSurfaceVariant)),
                const SizedBox(height: 12),
                Expanded(
                  child: ListView.separated(
                    controller: scrollController,
                    itemCount: fields.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final field = fields[index];
                      final v1 = record1[field] ?? '';
                      final v2 = record2[field] ?? '';
                      final selected = choices[field];

                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(_formatFieldName(field),
                                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                                    fontWeight: FontWeight.w600,
                                    color: Theme.of(context).colorScheme.onSurfaceVariant)),
                            const SizedBox(height: 6),
                            Row(
                              children: [
                                Expanded(
                                  child: _MergeFieldOption(
                                    value: v1,
                                    isSelected: selected == 'record1',
                                    label: 'Record A',
                                    onTap: () => setSheetState(() => choices[field] = 'record1'),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: _MergeFieldOption(
                                    value: v2,
                                    isSelected: selected == 'record2',
                                    label: 'Record B',
                                    onTap: () => setSheetState(() => choices[field] = 'record2'),
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton.icon(
                    onPressed: () {
                      Navigator.pop(ctx);
                      _executeMerge(pair, choices);
                    },
                    icon: const Icon(Icons.merge),
                    label: const Text('Confirm Merge'),
                  ),
                ),
                const SizedBox(height: 8),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _formatFieldName(String field) {
    return field.replaceAllMapped(RegExp(r'([A-Z])'), (m) => ' ${m[1]}')
        .replaceAll('_', ' ')
        .trim()
        .split(' ')
        .map((w) => w.isNotEmpty ? '${w[0].toUpperCase()}${w.substring(1)}' : '')
        .join(' ');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final visiblePairs = _pairs.where((p) => !_dismissed.contains(_pairKey(p))).toList();

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Data Deduplication'),
            Text('Find and merge duplicate records',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            tooltip: 'Scan for Duplicates',
            onPressed: _loading ? null : _scan,
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(icon: Icon(Icons.people), text: 'Contacts'),
            Tab(icon: Icon(Icons.business), text: 'Companies'),
          ],
        ),
      ),
      body: Column(
        children: [
          // Stats summary
          if (_stats != null) _buildStatsSummary(theme),

          // Scan button if not yet scanned
          if (!_scanned && !_loading)
            Expanded(
              child: EmptyState(
                icon: Icons.find_replace,
                title: 'Scan for Duplicates',
                subtitle: 'Tap the search icon to find duplicate ${_entityType == 'contact' ? 'contacts' : 'companies'}',
                action: ElevatedButton.icon(
                  onPressed: _scan,
                  icon: const Icon(Icons.search),
                  label: const Text('Start Scan'),
                ),
              ),
            ),

          // Loading
          if (_loading)
            const Expanded(child: Center(child: CircularProgressIndicator())),

          // Error
          if (_error != null && !_loading)
            Expanded(child: ErrorView(message: _error!, onRetry: _scan)),

          // Results
          if (_scanned && !_loading && _error == null)
            Expanded(
              child: visiblePairs.isEmpty
                  ? EmptyState(
                      icon: Icons.check_circle_outline,
                      title: 'No Duplicates Found',
                      subtitle: 'Your ${_entityType == 'contact' ? 'contact' : 'company'} records look clean!',
                    )
                  : Column(
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                          child: Row(
                            children: [
                              Text('${visiblePairs.length} potential duplicate${visiblePairs.length != 1 ? 's' : ''}',
                                  style: theme.textTheme.bodySmall?.copyWith(
                                      color: theme.colorScheme.onSurfaceVariant)),
                              const Spacer(),
                              TextButton.icon(
                                onPressed: _scan,
                                icon: const Icon(Icons.refresh, size: 16),
                                label: const Text('Re-scan'),
                                style: TextButton.styleFrom(
                                  visualDensity: VisualDensity.compact,
                                  textStyle: const TextStyle(fontSize: 12),
                                ),
                              ),
                            ],
                          ),
                        ),
                        Expanded(
                          child: RefreshIndicator(
                            onRefresh: _scan,
                            child: ListView.builder(
                              padding: const EdgeInsets.symmetric(horizontal: 12),
                              itemCount: visiblePairs.length,
                              itemBuilder: (context, index) =>
                                  _buildDuplicateCard(theme, visiblePairs[index]),
                            ),
                          ),
                        ),
                        if (_total > _pageSize) _buildPaginationBar(theme),
                      ],
                    ),
            ),
        ],
      ),
    );
  }

  Widget _buildStatsSummary(ThemeData theme) {
    return Container(
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          Expanded(child: _MiniStat(
            label: 'Total Found',
            value: '${_stats!['totalFound'] ?? _stats!['total_found'] ?? 0}',
            color: Colors.blue,
          )),
          const SizedBox(width: 8),
          Expanded(child: _MiniStat(
            label: 'Merged Today',
            value: '${_stats!['mergedToday'] ?? _stats!['merged_today'] ?? 0}',
            color: Colors.green,
          )),
          const SizedBox(width: 8),
          Expanded(child: _MiniStat(
            label: 'Remaining',
            value: '${_stats!['remaining'] ?? 0}',
            color: Colors.orange,
          )),
        ],
      ),
    );
  }

  Widget _buildDuplicateCard(ThemeData theme, Map<String, dynamic> pair) {
    final name1 = (pair['name1'] ?? pair['record1']?['fullName'] ?? pair['record1']?['name'] ?? '').toString();
    final name2 = (pair['name2'] ?? pair['record2']?['fullName'] ?? pair['record2']?['name'] ?? '').toString();
    final detail1 = (pair['email1'] ?? pair['record1']?['email'] ?? pair['record1']?['domain'] ?? '').toString();
    final detail2 = (pair['email2'] ?? pair['record2']?['email'] ?? pair['record2']?['domain'] ?? '').toString();
    final confidence = (pair['confidence'] as num?) ?? 0;
    final reason = (pair['reason'] ?? pair['matchReason'] ?? pair['match_reason'] ?? '').toString();
    final confColor = _confidenceColor(confidence);

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            // Two records side by side
            Row(
              children: [
                // Record 1
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Record A', style: theme.textTheme.labelSmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant)),
                      const SizedBox(height: 2),
                      Text(name1, style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 13),
                          maxLines: 1, overflow: TextOverflow.ellipsis),
                      if (detail1.isNotEmpty)
                        Text(detail1, style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant),
                            maxLines: 1, overflow: TextOverflow.ellipsis),
                    ],
                  ),
                ),
                // Confidence badge
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: Column(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: confColor.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text('${confidence.toInt()}%',
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: confColor)),
                      ),
                      const SizedBox(height: 2),
                      Text('match', style: TextStyle(fontSize: 9, color: theme.colorScheme.onSurfaceVariant)),
                    ],
                  ),
                ),
                // Record 2
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text('Record B', style: theme.textTheme.labelSmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant)),
                      const SizedBox(height: 2),
                      Text(name2, style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 13),
                          maxLines: 1, overflow: TextOverflow.ellipsis, textAlign: TextAlign.end),
                      if (detail2.isNotEmpty)
                        Text(detail2, style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant),
                            maxLines: 1, overflow: TextOverflow.ellipsis, textAlign: TextAlign.end),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),

            // Match reason
            if (reason.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    Icon(Icons.info_outline, size: 14, color: theme.colorScheme.onSurfaceVariant),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(reason,
                          style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant, fontSize: 11),
                          maxLines: 1, overflow: TextOverflow.ellipsis),
                    ),
                  ],
                ),
              ),

            // Actions
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                OutlinedButton.icon(
                  onPressed: () => _dismiss(pair),
                  icon: const Icon(Icons.close, size: 16),
                  label: const Text('Dismiss'),
                  style: OutlinedButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    textStyle: const TextStyle(fontSize: 12),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton.icon(
                  onPressed: () => _showMergePreview(pair),
                  icon: const Icon(Icons.merge, size: 16),
                  label: const Text('Merge'),
                  style: FilledButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    textStyle: const TextStyle(fontSize: 12),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPaginationBar(ThemeData theme) {
    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(top: BorderSide(color: theme.colorScheme.outlineVariant)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          IconButton(
            icon: const Icon(Icons.chevron_left),
            onPressed: _currentPage > 1 ? () => _goToPage(_currentPage - 1) : null,
            visualDensity: VisualDensity.compact,
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: theme.colorScheme.primaryContainer,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Text(
              'Page $_currentPage of $_totalPages',
              style: theme.textTheme.labelMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                  color: theme.colorScheme.onPrimaryContainer),
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            icon: const Icon(Icons.chevron_right),
            onPressed: _currentPage < _totalPages ? () => _goToPage(_currentPage + 1) : null,
            visualDensity: VisualDensity.compact,
          ),
        ],
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  final String label;
  final String value;
  final Color color;

  const _MiniStat({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: color.withOpacity(0.06),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withOpacity(0.15)),
      ),
      child: Column(
        children: [
          Text(value, style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.bold, color: color)),
          const SizedBox(height: 2),
          Text(label, style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant, fontSize: 10)),
        ],
      ),
    );
  }
}

class _MergeFieldOption extends StatelessWidget {
  final String value;
  final bool isSelected;
  final String label;
  final VoidCallback onTap;

  const _MergeFieldOption({
    required this.value,
    required this.isSelected,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: isSelected ? theme.colorScheme.primary : theme.colorScheme.outlineVariant,
            width: isSelected ? 2 : 1,
          ),
          color: isSelected ? theme.colorScheme.primary.withOpacity(0.05) : null,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  isSelected ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                  size: 16,
                  color: isSelected ? theme.colorScheme.primary : theme.colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: 4),
                Text(label, style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant)),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              value.isEmpty ? '(empty)' : value,
              style: theme.textTheme.bodySmall?.copyWith(
                fontWeight: FontWeight.w500,
                fontStyle: value.isEmpty ? FontStyle.italic : null,
                color: value.isEmpty ? theme.colorScheme.onSurfaceVariant : null,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}
