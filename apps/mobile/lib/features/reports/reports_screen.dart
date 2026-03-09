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

const _sourceFields = <String, List<Map<String, String>>>{
  'activities': [
    {'key': 'id', 'label': 'Activity ID'},
    {'key': 'type', 'label': 'Type'},
    {'key': 'direction', 'label': 'Direction'},
    {'key': 'subject', 'label': 'Subject'},
    {'key': 'summary', 'label': 'Summary'},
    {'key': 'sentiment', 'label': 'Sentiment'},
    {'key': 'duration_seconds', 'label': 'Duration seconds'},
    {'key': 'occurred_at', 'label': 'Occurred at'},
    {'key': 'deal_id', 'label': 'Deal ID'},
    {'key': 'company_id', 'label': 'Company ID'},
    {'key': 'source', 'label': 'Source'},
    {'key': 'created_at', 'label': 'Created date'},
    {'key': 'created_by', 'label': 'Created By'},
  ],
  'deals': [
    {'key': 'id', 'label': 'Deal ID'},
    {'key': 'name', 'label': 'Name'},
    {'key': 'stage', 'label': 'Stage'},
    {'key': 'value', 'label': 'Value'},
    {'key': 'currency', 'label': 'Currency'},
    {'key': 'close_date', 'label': 'Close Date'},
    {'key': 'company_id', 'label': 'Company ID'},
    {'key': 'owner_id', 'label': 'Owner ID'},
    {'key': 'reality_score', 'label': 'Reality Score'},
    {'key': 'created_at', 'label': 'Created date'},
    {'key': 'updated_at', 'label': 'Last update date'},
  ],
  'companies': [
    {'key': 'id', 'label': 'Company ID'},
    {'key': 'name', 'label': 'Name'},
    {'key': 'domain', 'label': 'Domain'},
    {'key': 'city', 'label': 'City'},
    {'key': 'country', 'label': 'Country'},
    {'key': 'industry', 'label': 'Industry'},
    {'key': 'revenue', 'label': 'Revenue'},
    {'key': 'employees', 'label': 'Employees'},
    {'key': 'segment', 'label': 'Segment'},
    {'key': 'created_at', 'label': 'Created Date'},
    {'key': 'updated_at', 'label': 'Last update date'},
  ],
  'contacts': [
    {'key': 'id', 'label': 'Contact ID'},
    {'key': 'firstName', 'label': 'First Name'},
    {'key': 'lastName', 'label': 'Last Name'},
    {'key': 'fullName', 'label': 'Full Name'},
    {'key': 'email', 'label': 'Email'},
    {'key': 'title', 'label': 'Title'},
    {'key': 'seniority', 'label': 'Seniority'},
    {'key': 'isLead', 'label': 'Previous Lead'},
    {'key': 'created_at', 'label': 'Created date'},
    {'key': 'updated_at', 'label': 'Last update date'},
  ],
  'quotes': [
    {'key': 'id', 'label': 'Quote ID'},
    {'key': 'quote_number', 'label': 'Quote Number'},
    {'key': 'title', 'label': 'Title'},
    {'key': 'status', 'label': 'Status'},
    {'key': 'company_name', 'label': 'Company Name'},
    {'key': 'contact_name', 'label': 'Contact Name'},
    {'key': 'total', 'label': 'Total'},
    {'key': 'subtotal', 'label': 'Subtotal'},
    {'key': 'currency', 'label': 'Currency'},
    {'key': 'valid_until', 'label': 'Valid Until'},
    {'key': 'created_at', 'label': 'Created At'},
  ],
  'users': [
    {'key': 'id', 'label': 'User ID'},
    {'key': 'first_name', 'label': 'First Name'},
    {'key': 'last_name', 'label': 'Last Name'},
    {'key': 'email', 'label': 'Email'},
    {'key': 'role', 'label': 'Role'},
    {'key': 'can_quote', 'label': 'Can Quote'},
    {'key': 'country', 'label': 'Country'},
    {'key': 'timezone', 'label': 'Timezone'},
  ],
};

const _filterOps = <Map<String, String>>[
  {'value': 'eq', 'label': 'equals'},
  {'value': 'neq', 'label': 'not equals'},
  {'value': 'contains', 'label': 'contains'},
  {'value': 'not_contains', 'label': 'not contains'},
  {'value': 'gt', 'label': 'greater than'},
  {'value': 'gte', 'label': '>='},
  {'value': 'lt', 'label': 'less than'},
  {'value': 'lte', 'label': '<='},
  {'value': 'is_null', 'label': 'is empty'},
  {'value': 'not_null', 'label': 'is not empty'},
];

const _chartTypes = ['table', 'bar', 'line', 'pie'];

const _chartTypeIcons = <String, IconData>{
  'table': Icons.table_chart_outlined,
  'bar': Icons.bar_chart,
  'line': Icons.show_chart,
  'pie': Icons.pie_chart_outline,
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

  // Builder state
  final Set<String> _bSources = {};
  final Set<String> _bSelectedFields = {};
  final List<Map<String, String>> _bFilters = [];
  String _bFilterLogic = 'AND';
  String _bGroupBy = '';
  String _bSortBy = '';
  String _bSortDir = 'asc';
  String _bChartType = 'table';
  bool _bPreviewing = false;
  bool _bSaving = false;
  Map<String, dynamic>? _bPreviewResult;
  final _bNameCtl = TextEditingController();
  final _bDescCtl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _loadReports();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    _bNameCtl.dispose();
    _bDescCtl.dispose();
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

  // ── Builder helpers ─────────────────────────────────────────────────

  List<Map<String, String>> get _bAvailableFields {
    final fields = <Map<String, String>>[];
    for (final source in _bSources) {
      final sf = _sourceFields[source] ?? [];
      for (final f in sf) {
        fields.add({'key': '$source.${f['key']}', 'label': '${_sourceLabels[source]}.${f['label']}'});
      }
    }
    return fields;
  }

  Map<String, dynamic> get _bSpec {
    final fields = _bSelectedFields.isNotEmpty
        ? _bSelectedFields.map((key) {
            final parts = key.split('.');
            return {'source': parts[0], 'field': parts.sublist(1).join('.'), 'alias': key};
          }).toList()
        : _bSources.expand((s) {
            final sf = _sourceFields[s] ?? [];
            return sf.take(5).map((f) => {'source': s, 'field': f['key'], 'alias': '$s.${f['key']}'});
          }).toList();

    final conditions = _bFilters
        .where((f) => (f['field'] ?? '').isNotEmpty && ((f['value'] ?? '').isNotEmpty || ['is_null', 'not_null'].contains(f['op'])))
        .map((f) {
      final parts = (f['field'] ?? '').split('.');
      return {
        'source': parts.isNotEmpty ? parts[0] : '',
        'field': parts.length > 1 ? parts.sublist(1).join('.') : '',
        'op': f['op'] ?? 'eq',
        if (!['is_null', 'not_null'].contains(f['op'])) 'value': f['value'],
      };
    }).toList();

    return {
      'sources': _bSources.toList(),
      'fields': fields,
      'filters': {'logic': _bFilterLogic, 'conditions': conditions},
      if (_bGroupBy.isNotEmpty) 'groupBy': _bGroupBy,
      if (_bSortBy.isNotEmpty) 'orderBy': {'field': _bSortBy, 'direction': _bSortDir},
      'limit': 5000,
    };
  }

  Future<void> _bRunPreview() async {
    if (_bSources.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Select at least one data source')),
      );
      return;
    }
    setState(() { _bPreviewing = true; _bPreviewResult = null; });
    try {
      final res = await ApiClient.instance.dio.post(
        '${Endpoints.reports}/run',
        data: {'spec': {..._bSpec, 'limit': 20}},
      );
      if (mounted) setState(() => _bPreviewResult = res.data['data']);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to run preview')),
        );
      }
    } finally {
      if (mounted) setState(() => _bPreviewing = false);
    }
  }

  Future<void> _bSaveReport() async {
    if (_bNameCtl.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Report name is required')),
      );
      return;
    }
    if (_bSources.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Select at least one data source')),
      );
      return;
    }
    setState(() => _bSaving = true);
    try {
      await ApiClient.instance.dio.post(Endpoints.reports, data: {
        'name': _bNameCtl.text.trim(),
        'description': _bDescCtl.text.trim(),
        'spec': _bSpec,
        'chartType': _bChartType,
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Report saved')),
        );
        _bNameCtl.clear();
        _bDescCtl.clear();
        _loadReports();
        _tabController.animateTo(0);
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to save report')),
        );
      }
    } finally {
      if (mounted) setState(() => _bSaving = false);
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
            Tab(icon: Icon(Icons.build_outlined, size: 18), text: 'Builder'),
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
          _buildBuilderTab(theme),
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
                            onPressed: () => _tabController.animateTo(2),
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

  // ── Builder Tab ─────────────────────────────────────────────────────

  Widget _buildBuilderTab(ThemeData theme) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Data source picker
        Text('DATA SOURCE', style: theme.textTheme.labelSmall?.copyWith(
            fontWeight: FontWeight.w600, letterSpacing: 1, color: theme.colorScheme.onSurfaceVariant)),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: _sourceLabels.entries.map((e) {
            final selected = _bSources.contains(e.key);
            return FilterChip(
              label: Text(e.value, style: const TextStyle(fontSize: 12)),
              selected: selected,
              showCheckmark: true,
              onSelected: (v) {
                setState(() {
                  if (v) {
                    _bSources.add(e.key);
                  } else {
                    _bSources.remove(e.key);
                    _bSelectedFields.removeWhere((f) => f.startsWith('${e.key}.'));
                  }
                });
              },
            );
          }).toList(),
        ),

        if (_bSources.isNotEmpty) ...[
          const SizedBox(height: 20),

          // Field multi-select per source
          Text('FIELDS', style: theme.textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w600, letterSpacing: 1, color: theme.colorScheme.onSurfaceVariant)),
          const SizedBox(height: 4),
          Text('Select fields to include. Leave empty for defaults.',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          const SizedBox(height: 8),

          ..._bSources.map((source) {
            final fields = _sourceFields[source] ?? [];
            return Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(_sourceLabels[source] ?? source,
                            style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            TextButton(
                              onPressed: () => setState(() {
                                for (final f in fields) _bSelectedFields.add('$source.${f['key']}');
                              }),
                              child: const Text('All', style: TextStyle(fontSize: 12)),
                            ),
                            TextButton(
                              onPressed: () => setState(() {
                                for (final f in fields) _bSelectedFields.remove('$source.${f['key']}');
                              }),
                              child: const Text('None', style: TextStyle(fontSize: 12)),
                            ),
                          ],
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: 4,
                      runSpacing: 0,
                      children: fields.map((f) {
                        final key = '$source.${f['key']}';
                        return FilterChip(
                          label: Text(f['label'] ?? f['key']!, style: const TextStyle(fontSize: 11)),
                          selected: _bSelectedFields.contains(key),
                          onSelected: (v) => setState(() {
                            if (v) { _bSelectedFields.add(key); } else { _bSelectedFields.remove(key); }
                          }),
                          visualDensity: VisualDensity.compact,
                        );
                      }).toList(),
                    ),
                  ],
                ),
              ),
            );
          }),

          const SizedBox(height: 16),

          // Filter builder
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('FILTERS', style: theme.textTheme.labelSmall?.copyWith(
                  fontWeight: FontWeight.w600, letterSpacing: 1, color: theme.colorScheme.onSurfaceVariant)),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'AND', label: Text('AND')),
                  ButtonSegment(value: 'OR', label: Text('OR')),
                ],
                selected: {_bFilterLogic},
                onSelectionChanged: (v) => setState(() => _bFilterLogic = v.first),
                style: const ButtonStyle(visualDensity: VisualDensity.compact),
              ),
            ],
          ),
          const SizedBox(height: 8),

          ..._bFilters.asMap().entries.map((entry) {
            final i = entry.key;
            final filter = entry.value;
            final availFields = _bAvailableFields;
            return Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Column(
                  children: [
                    if (i > 0)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 4),
                        child: Text(_bFilterLogic, style: TextStyle(
                          fontSize: 11, fontWeight: FontWeight.w600,
                          color: theme.colorScheme.primary,
                        )),
                      ),
                    Row(
                      children: [
                        Expanded(
                          child: DropdownButtonFormField<String>(
                            value: availFields.any((f) => f['key'] == filter['field']) ? filter['field'] : null,
                            decoration: const InputDecoration(labelText: 'Field', isDense: true),
                            items: availFields.map((f) => DropdownMenuItem(
                              value: f['key'],
                              child: Text(f['label']!, style: const TextStyle(fontSize: 11)),
                            )).toList(),
                            onChanged: (v) => setState(() => filter['field'] = v ?? ''),
                          ),
                        ),
                        const SizedBox(width: 4),
                        SizedBox(
                          width: 80,
                          child: DropdownButtonFormField<String>(
                            value: filter['op'],
                            decoration: const InputDecoration(labelText: 'Op', isDense: true),
                            items: _filterOps.map((o) => DropdownMenuItem(
                              value: o['value'],
                              child: Text(o['label']!, style: const TextStyle(fontSize: 11)),
                            )).toList(),
                            onChanged: (v) => setState(() => filter['op'] = v ?? 'eq'),
                          ),
                        ),
                        const SizedBox(width: 4),
                        if (!['is_null', 'not_null'].contains(filter['op']))
                          Expanded(
                            child: TextField(
                              decoration: const InputDecoration(labelText: 'Value', isDense: true),
                              controller: TextEditingController(text: filter['value']),
                              onChanged: (v) => filter['value'] = v,
                            ),
                          ),
                        IconButton(
                          icon: const Icon(Icons.close, size: 18),
                          onPressed: () => setState(() => _bFilters.removeAt(i)),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          }),

          TextButton.icon(
            onPressed: () => setState(() => _bFilters.add({'field': '', 'op': 'eq', 'value': ''})),
            icon: const Icon(Icons.add, size: 18),
            label: const Text('Add filter'),
          ),

          const SizedBox(height: 16),

          // Group by selector
          Text('GROUP BY', style: theme.textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w600, letterSpacing: 1, color: theme.colorScheme.onSurfaceVariant)),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            value: _bAvailableFields.any((f) => f['key'] == _bGroupBy) ? _bGroupBy : null,
            decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true, hintText: 'None'),
            items: [
              const DropdownMenuItem(value: '', child: Text('None')),
              ..._bAvailableFields.map((f) => DropdownMenuItem(value: f['key'], child: Text(f['label']!, style: const TextStyle(fontSize: 12)))),
            ],
            onChanged: (v) => setState(() => _bGroupBy = v ?? ''),
          ),

          const SizedBox(height: 16),

          // Sort by selector
          Text('SORT BY', style: theme.textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w600, letterSpacing: 1, color: theme.colorScheme.onSurfaceVariant)),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  value: _bAvailableFields.any((f) => f['key'] == _bSortBy) ? _bSortBy : null,
                  decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true, hintText: 'None'),
                  items: [
                    const DropdownMenuItem(value: '', child: Text('None')),
                    ..._bAvailableFields.map((f) => DropdownMenuItem(value: f['key'], child: Text(f['label']!, style: const TextStyle(fontSize: 12)))),
                  ],
                  onChanged: (v) => setState(() => _bSortBy = v ?? ''),
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                width: 100,
                child: DropdownButtonFormField<String>(
                  value: _bSortDir,
                  decoration: const InputDecoration(border: OutlineInputBorder(), isDense: true),
                  items: const [
                    DropdownMenuItem(value: 'asc', child: Text('Asc')),
                    DropdownMenuItem(value: 'desc', child: Text('Desc')),
                  ],
                  onChanged: (v) => setState(() => _bSortDir = v ?? 'asc'),
                ),
              ),
            ],
          ),

          const SizedBox(height: 16),

          // Chart type selector
          Text('CHART TYPE', style: theme.textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w600, letterSpacing: 1, color: theme.colorScheme.onSurfaceVariant)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _chartTypes.map((t) {
              final selected = _bChartType == t;
              return ChoiceChip(
                label: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(_chartTypeIcons[t] ?? Icons.table_chart, size: 16),
                    const SizedBox(width: 4),
                    Text(t[0].toUpperCase() + t.substring(1), style: const TextStyle(fontSize: 12)),
                  ],
                ),
                selected: selected,
                onSelected: (_) => setState(() => _bChartType = t),
              );
            }).toList(),
          ),

          const SizedBox(height: 20),

          // Preview button
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _bPreviewing ? null : _bRunPreview,
                  icon: _bPreviewing
                      ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.play_arrow, size: 18),
                  label: const Text('Preview (20 rows)'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton.icon(
                  onPressed: _bSaving ? null : () => _showSaveDialog(theme),
                  icon: _bSaving
                      ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.save, size: 18),
                  label: const Text('Save Report'),
                ),
              ),
            ],
          ),

          // Preview results
          if (_bPreviewResult != null) ...[
            const SizedBox(height: 16),
            _buildBuilderPreview(theme),
          ],
        ],

        const SizedBox(height: 80), // Space for FAB
      ],
    );
  }

  void _showSaveDialog(ThemeData theme) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Save Report'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _bNameCtl,
              decoration: const InputDecoration(
                labelText: 'Report name *',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _bDescCtl,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'Description',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              Navigator.pop(ctx);
              _bSaveReport();
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  Widget _buildBuilderPreview(ThemeData theme) {
    final columns = List<String>.from(_bPreviewResult!['columns'] ?? []);
    final rows = List<Map<String, dynamic>>.from(_bPreviewResult!['rows'] ?? []);
    final rowCount = _bPreviewResult!['rowCount'] ?? rows.length;

    return Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text('$rowCount rows total (showing ${rows.length})',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ),
          if (rows.isEmpty)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Center(child: Text('No data', style: theme.textTheme.bodySmall)),
            )
          else
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                columnSpacing: 20,
                columns: columns.map((c) => DataColumn(
                  label: Text(c.split('.').last, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12)),
                )).toList(),
                rows: rows.map((row) => DataRow(
                  cells: columns.map((c) => DataCell(
                    Text('${row[c] ?? ''}', style: const TextStyle(fontSize: 12)),
                  )).toList(),
                )).toList(),
              ),
            ),
        ],
      ),
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
