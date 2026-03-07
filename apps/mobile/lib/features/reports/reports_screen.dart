import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import 'package:go_router/go_router.dart';
import '../../shared/widgets/error_view.dart';

const _sourceLabels = <String, String>{
  'activities': 'Activities',
  'deals': 'Opportunities',
  'companies': 'Companies',
  'contacts': 'Contacts',
  'quotes': 'Quotes',
  'users': 'Users',
};

class ReportsScreen extends ConsumerStatefulWidget {
  const ReportsScreen({super.key});

  @override
  ConsumerState<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends ConsumerState<ReportsScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<Map<String, dynamic>> _reports = [];
  bool _loading = true;
  String? _error;
  String _search = '';
  final _searchController = TextEditingController();

  // Quick Run state
  final Set<String> _qrSources = {'activities'};
  bool _qrRunning = false;
  Map<String, dynamic>? _qrResult;
  String? _qrError;
  String _qrPeriod = '';
  int _qrLimit = 1000;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadReports();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadReports() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.reports);
      if (mounted) setState(() => _reports = List<Map<String, dynamic>>.from(res.data['data'] ?? []));
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load reports');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _runReport(Map<String, dynamic> report) async {
    final spec = report['spec'];
    if (spec == null) return;

    showDialog(context: context, barrierDismissible: false,
        builder: (_) => const Center(child: CircularProgressIndicator()));

    try {
      final res = await ApiClient.instance.dio.post('${Endpoints.reports}/run', data: {'spec': spec});
      if (mounted) {
        Navigator.pop(context);
        _showResults(report['name'] ?? 'Report', res.data['data']);
      }
    } catch (_) {
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to run report')));
      }
    }
  }

  Future<void> _deleteReport(String id) async {
    try {
      await ApiClient.instance.dio.delete('${Endpoints.reports}/$id');
      setState(() => _reports.removeWhere((r) => r['id'] == id));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to delete')));
    }
  }

  Future<void> _runQuickQuery() async {
    setState(() { _qrRunning = true; _qrError = null; _qrResult = null; });
    final spec = {
      'sources': _qrSources.toList(),
      'fields': _qrSources.expand((s) => [
        {'source': s, 'field': 'id', 'alias': '$s.id'},
      ]).toList(),
      'filters': {'logic': 'AND', 'conditions': []},
      if (_qrPeriod.isNotEmpty) 'period': {'field': 'created_at', 'range': _qrPeriod},
      'limit': _qrLimit,
    };
    try {
      final res = await ApiClient.instance.dio.post('${Endpoints.reports}/run', data: {'spec': spec});
      if (mounted) setState(() => _qrResult = res.data['data']);
    } catch (_) {
      if (mounted) setState(() => _qrError = 'Failed to run query');
    } finally {
      if (mounted) setState(() => _qrRunning = false);
    }
  }

  void _showResults(String name, Map<String, dynamic> result) {
    final columns = List<String>.from(result['columns'] ?? []);
    final rows = List<Map<String, dynamic>>.from(result['rows'] ?? []);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.85,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        expand: false,
        builder: (_, scrollController) => Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Expanded(child: Text(name,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold))),
                  Text('${rows.length} rows', style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(width: 8),
                  IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(context)),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: rows.isEmpty
                  ? const Center(child: Text('No data'))
                  : SingleChildScrollView(
                      controller: scrollController,
                      scrollDirection: Axis.horizontal,
                      child: DataTable(
                        columns: columns.map((c) => DataColumn(label: Text(c, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12)))).toList(),
                        rows: rows.map((row) => DataRow(
                          cells: columns.map((c) => DataCell(Text('${row[c] ?? ''}', style: const TextStyle(fontSize: 13)))).toList(),
                        )).toList(),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  String _fmtRelative(String? iso) {
    if (iso == null || iso.isEmpty) return '';
    try {
      final dt = DateTime.parse(iso);
      final diff = DateTime.now().difference(dt);
      if (diff.inMinutes < 1) return 'just now';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      if (diff.inHours < 24) return '${diff.inHours}h ago';
      if (diff.inDays < 7) return '${diff.inDays}d ago';
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Reports'),
            Text('Cross-object analytics', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ],
        ),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadReports),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(icon: Icon(Icons.folder_outlined, size: 18), text: 'Saved Reports'),
            Tab(icon: Icon(Icons.play_arrow_outlined, size: 18), text: 'Quick Run'),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () async {
          final created = await context.push<bool>('/reports/new');
          if (created == true) _loadReports();
        },
        child: const Icon(Icons.add),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildSavedTab(theme),
          _buildQuickRunTab(theme),
        ],
      ),
    );
  }

  Widget _buildSavedTab(ThemeData theme) {
    if (_error != null) return ErrorView(message: _error!, onRetry: _loadReports);
    if (_loading) return const Center(child: CircularProgressIndicator());

    final filtered = _search.isEmpty
        ? _reports
        : _reports.where((r) {
            final s = _search.toLowerCase();
            return (r['name'] ?? '').toString().toLowerCase().contains(s) ||
                (r['description'] ?? '').toString().toLowerCase().contains(s);
          }).toList();

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
          child: TextField(
            controller: _searchController,
            decoration: InputDecoration(
              hintText: 'Search reports...',
              prefixIcon: const Icon(Icons.search, size: 20),
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(vertical: 10),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
              suffixIcon: _search.isNotEmpty
                  ? IconButton(icon: const Icon(Icons.clear, size: 18), onPressed: () {
                      _searchController.clear();
                      setState(() => _search = '');
                    })
                  : null,
            ),
            onChanged: (v) => setState(() => _search = v),
          ),
        ),
        Expanded(
          child: filtered.isEmpty
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.bar_chart, size: 48, color: theme.colorScheme.onSurfaceVariant.withOpacity(0.3)),
                      const SizedBox(height: 12),
                      Text('No saved reports yet', style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                      const SizedBox(height: 4),
                      Text('Use Quick Run to explore, then save',
                          style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                      const SizedBox(height: 16),
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          OutlinedButton(
                            onPressed: () => _tabController.animateTo(1),
                            child: const Text('Quick Run'),
                          ),
                          const SizedBox(width: 8),
                          FilledButton(
                            onPressed: () => context.push('/reports/new'),
                            child: const Text('Report Builder'),
                          ),
                        ],
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadReports,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(12),
                    itemCount: filtered.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final r = filtered[index];
                      final sources = (r['spec']?['sources'] as List?)?.cast<String>() ?? [];
                      final snapshot = r['lastSnapshot'];

                      return Card(
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(r['name'] ?? 'Untitled',
                                          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                                      if (r['description'] != null && r['description'].toString().isNotEmpty)
                                        Text(r['description'], maxLines: 1, overflow: TextOverflow.ellipsis,
                                            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                                    ],
                                  )),
                                  IconButton(
                                    icon: const Icon(Icons.play_arrow, size: 20),
                                    onPressed: () => _runReport(r),
                                    tooltip: 'Run',
                                    visualDensity: VisualDensity.compact,
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.delete_outline, size: 20, color: Colors.red),
                                    onPressed: () async {
                                      final confirm = await showDialog<bool>(
                                        context: context,
                                        builder: (ctx) => AlertDialog(
                                          title: const Text('Delete report?'),
                                          actions: [
                                            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
                                            TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Delete', style: TextStyle(color: Colors.red))),
                                          ],
                                        ),
                                      );
                                      if (confirm == true) _deleteReport(r['id']);
                                    },
                                    tooltip: 'Delete',
                                    visualDensity: VisualDensity.compact,
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Wrap(
                                spacing: 4,
                                runSpacing: 4,
                                children: [
                                  ...sources.map((s) => Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: Colors.deepPurple.withOpacity(0.1),
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: Text(_sourceLabels[s] ?? s,
                                        style: const TextStyle(fontSize: 11, color: Colors.deepPurple, fontWeight: FontWeight.w500)),
                                  )),
                                  if (snapshot != null)
                                    Text(
                                      '${_fmtRelative(snapshot['taken_at'])} · ${snapshot['row_count'] ?? 0} rows',
                                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                                    ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
        ),
      ],
    );
  }

  Widget _buildQuickRunTab(ThemeData theme) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('SOURCES', style: theme.textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w600, letterSpacing: 1, color: theme.colorScheme.onSurfaceVariant)),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: _sourceLabels.entries.map((e) {
            final selected = _qrSources.contains(e.key);
            return FilterChip(
              label: Text(e.value, style: const TextStyle(fontSize: 12)),
              selected: selected,
              onSelected: (v) {
                setState(() {
                  if (v) { _qrSources.add(e.key); }
                  else if (_qrSources.length > 1) { _qrSources.remove(e.key); }
                });
              },
            );
          }).toList(),
        ),

        const SizedBox(height: 20),
        Text('PERIOD', style: theme.textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w600, letterSpacing: 1, color: theme.colorScheme.onSurfaceVariant)),
        const SizedBox(height: 8),
        DropdownButtonFormField<String>(
          value: _qrPeriod,
          decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true),
          items: const [
            DropdownMenuItem(value: '', child: Text('All time')),
            DropdownMenuItem(value: 'last_24_hours', child: Text('Last 24 hours')),
            DropdownMenuItem(value: 'last_7_days', child: Text('Last 7 days')),
            DropdownMenuItem(value: 'last_30_days', child: Text('Last 30 days')),
            DropdownMenuItem(value: 'last_90_days', child: Text('Last 90 days')),
            DropdownMenuItem(value: 'last_year', child: Text('Last year')),
          ],
          onChanged: (v) => setState(() => _qrPeriod = v ?? ''),
        ),

        const SizedBox(height: 16),
        Text('ROW LIMIT', style: theme.textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w600, letterSpacing: 1, color: theme.colorScheme.onSurfaceVariant)),
        const SizedBox(height: 8),
        DropdownButtonFormField<int>(
          value: _qrLimit,
          decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true),
          items: const [
            DropdownMenuItem(value: 100, child: Text('100')),
            DropdownMenuItem(value: 500, child: Text('500')),
            DropdownMenuItem(value: 1000, child: Text('1,000')),
            DropdownMenuItem(value: 2000, child: Text('2,000')),
            DropdownMenuItem(value: 5000, child: Text('5,000')),
          ],
          onChanged: (v) => setState(() => _qrLimit = v ?? 1000),
        ),

        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: _qrRunning ? null : _runQuickQuery,
          icon: _qrRunning
              ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Icon(Icons.play_arrow),
          label: const Text('Run Query'),
        ),

        if (_qrError != null) ...[
          const SizedBox(height: 12),
          Text(_qrError!, style: const TextStyle(color: Colors.red, fontSize: 13)),
        ],

        if (_qrResult != null) ...[
          const SizedBox(height: 16),
          Row(
            children: [
              Text('${_qrResult!['rowCount'] ?? (_qrResult!['rows'] as List?)?.length ?? 0} rows',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              const Spacer(),
              TextButton(onPressed: () => context.push('/reports/new'), child: const Text('Save as Report', style: TextStyle(fontSize: 12))),
            ],
          ),
          const SizedBox(height: 8),
          SizedBox(
            height: 400,
            child: _buildResultsTable(_qrResult!),
          ),
        ],
      ],
    );
  }

  Widget _buildResultsTable(Map<String, dynamic> result) {
    final columns = List<String>.from(result['columns'] ?? []);
    final rows = List<Map<String, dynamic>>.from(result['rows'] ?? []);
    if (rows.isEmpty) return const Center(child: Text('No data'));

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: SingleChildScrollView(
        child: DataTable(
          columnSpacing: 20,
          columns: columns.map((c) => DataColumn(label: Text(c, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12)))).toList(),
          rows: rows.take(500).map((row) => DataRow(
            cells: columns.map((c) => DataCell(Text(row[c]?.toString() ?? '-', style: const TextStyle(fontSize: 13)))).toList(),
          )).toList(),
        ),
      ),
    );
  }
}
