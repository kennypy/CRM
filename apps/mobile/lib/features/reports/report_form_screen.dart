import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';

class ReportFormScreen extends ConsumerStatefulWidget {
  const ReportFormScreen({super.key});

  @override
  ConsumerState<ReportFormScreen> createState() => _ReportFormScreenState();
}

class _ReportFormScreenState extends ConsumerState<ReportFormScreen> {
  int _step = 0; // 0=sources, 1=fields+filters, 2=preview+save
  bool _saving = false;

  // Step 1: Sources
  final Set<String> _selectedSources = {'activities'};

  // Step 2: Fields & Filters
  final Set<String> _selectedFields = {};
  final List<Map<String, String>> _filters = [];
  String _filterLogic = 'AND';
  String _period = 'all';
  String _limit = '100';

  // Step 3: Preview & Save
  final _nameCtl = TextEditingController();
  final _descCtl = TextEditingController();
  Map<String, dynamic>? _previewResult;
  bool _previewing = false;

  static const _sourceFields = {
    'activities': ['id', 'type', 'direction', 'subject', 'summary', 'sentiment', 'duration_seconds', 'occurred_at', 'deal_id', 'company_id', 'source', 'created_at'],
    'deals': ['id', 'name', 'stage', 'value', 'currency', 'close_date', 'company_id', 'owner_id', 'reality_score', 'created_at', 'updated_at'],
    'companies': ['id', 'name', 'domain', 'city', 'country', 'industry', 'revenue', 'employees', 'segment', 'created_at', 'updated_at'],
    'contacts': ['id', 'firstName', 'lastName', 'fullName', 'email', 'title', 'seniority', 'isLead', 'created_at', 'updated_at'],
    'quotes': ['id', 'quote_number', 'title', 'status', 'company_name', 'contact_name', 'total', 'subtotal', 'currency', 'valid_until', 'created_at'],
    'users': ['id', 'first_name', 'last_name', 'email', 'role', 'can_quote', 'country', 'timezone'],
  };

  static const _operators = ['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'is_null', 'not_null'];
  static const _operatorLabels = {'eq': '=', 'neq': '!=', 'contains': 'contains', 'gt': '>', 'gte': '>=', 'lt': '<', 'lte': '<=', 'is_null': 'is null', 'not_null': 'not null'};

  @override
  void dispose() {
    _nameCtl.dispose();
    _descCtl.dispose();
    super.dispose();
  }

  List<String> get _allAvailableFields {
    final fields = <String>[];
    for (final source in _selectedSources) {
      final sf = _sourceFields[source] ?? [];
      for (final f in sf) {
        final key = '${source}.$f';
        if (!fields.contains(key)) fields.add(key);
      }
    }
    return fields;
  }

  Map<String, dynamic> get _spec => {
    'sources': _selectedSources.toList(),
    'fields': _selectedFields.toList(),
    'filters': _filters.map((f) => {
      'source': f['source'], 'field': f['field'],
      'operator': f['operator'], 'value': f['value'],
    }).toList(),
    'filterLogic': _filterLogic,
    'period': _period,
    'limit': int.tryParse(_limit) ?? 100,
  };

  Future<void> _runPreview() async {
    setState(() { _previewing = true; _previewResult = null; });
    try {
      final res = await ApiClient.instance.dio.post('${Endpoints.reports}/run', data: {
        'spec': {..._spec, 'limit': 20},
      });
      if (mounted) setState(() => _previewResult = res.data['data']);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to run preview')),
        );
      }
    } finally {
      if (mounted) setState(() => _previewing = false);
    }
  }

  Future<void> _saveReport() async {
    if (_nameCtl.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Report name is required')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      await ApiClient.instance.dio.post(Endpoints.reports, data: {
        'name': _nameCtl.text.trim(),
        'description': _descCtl.text.trim(),
        'spec': _spec,
      });
      if (mounted) context.pop(true);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to save report')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Report Builder'),
        actions: [
          if (_step == 2)
            TextButton(
              onPressed: _saving ? null : _saveReport,
              child: _saving
                  ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Save'),
            ),
        ],
      ),
      body: Column(
        children: [
          // Step indicator
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: [
                _StepDot(label: 'Sources', index: 0, current: _step),
                Expanded(child: Divider(color: _step >= 1 ? theme.colorScheme.primary : null)),
                _StepDot(label: 'Fields', index: 1, current: _step),
                Expanded(child: Divider(color: _step >= 2 ? theme.colorScheme.primary : null)),
                _StepDot(label: 'Preview', index: 2, current: _step),
              ],
            ),
          ),
          const Divider(height: 1),

          // Step content
          Expanded(child: _buildStep()),

          // Navigation
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                if (_step > 0)
                  OutlinedButton(
                    onPressed: () => setState(() => _step--),
                    child: const Text('Previous'),
                  ),
                const Spacer(),
                if (_step < 2)
                  ElevatedButton(
                    onPressed: _canAdvance ? () => setState(() => _step++) : null,
                    child: const Text('Next'),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  bool get _canAdvance {
    if (_step == 0) return _selectedSources.isNotEmpty;
    if (_step == 1) return _selectedFields.isNotEmpty;
    return true;
  }

  Widget _buildStep() {
    switch (_step) {
      case 0: return _buildSourcesStep();
      case 1: return _buildFieldsStep();
      case 2: return _buildPreviewStep();
      default: return const SizedBox();
    }
  }

  Widget _buildSourcesStep() {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('Select data sources', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 4),
        Text('Choose which entities to include in your report',
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
        const SizedBox(height: 16),
        Wrap(
          spacing: 8, runSpacing: 8,
          children: _sourceFields.keys.map((source) {
            final selected = _selectedSources.contains(source);
            return FilterChip(
              label: Text(source[0].toUpperCase() + source.substring(1)),
              selected: selected,
              showCheckmark: true,
              onSelected: (v) {
                setState(() {
                  if (v) {
                    _selectedSources.add(source);
                  } else {
                    _selectedSources.remove(source);
                    _selectedFields.removeWhere((f) => f.startsWith('$source.'));
                  }
                });
              },
            );
          }).toList(),
        ),
      ],
    );
  }

  Widget _buildFieldsStep() {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Period
        Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<String>(
                value: _period,
                decoration: const InputDecoration(labelText: 'Time period'),
                items: const [
                  DropdownMenuItem(value: 'all', child: Text('All time')),
                  DropdownMenuItem(value: '24h', child: Text('Last 24h')),
                  DropdownMenuItem(value: '7d', child: Text('Last 7 days')),
                  DropdownMenuItem(value: '30d', child: Text('Last 30 days')),
                  DropdownMenuItem(value: '90d', child: Text('Last 90 days')),
                  DropdownMenuItem(value: '1y', child: Text('Last year')),
                ],
                onChanged: (v) => setState(() => _period = v!),
              ),
            ),
            const SizedBox(width: 12),
            SizedBox(
              width: 100,
              child: DropdownButtonFormField<String>(
                value: _limit,
                decoration: const InputDecoration(labelText: 'Limit'),
                items: ['100', '500', '1000', '2000', '5000'].map((l) =>
                  DropdownMenuItem(value: l, child: Text(l))).toList(),
                onChanged: (v) => setState(() => _limit = v!),
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),

        // Fields per source
        ..._selectedSources.map((source) {
          final fields = _sourceFields[source] ?? [];
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(source[0].toUpperCase() + source.substring(1),
                      style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                  Row(
                    children: [
                      TextButton(onPressed: () => setState(() {
                        for (final f in fields) _selectedFields.add('$source.$f');
                      }), child: const Text('All', style: TextStyle(fontSize: 12))),
                      TextButton(onPressed: () => setState(() {
                        for (final f in fields) _selectedFields.remove('$source.$f');
                      }), child: const Text('None', style: TextStyle(fontSize: 12))),
                    ],
                  ),
                ],
              ),
              Wrap(
                spacing: 4, runSpacing: 0,
                children: fields.map((f) {
                  final key = '$source.$f';
                  return FilterChip(
                    label: Text(f, style: const TextStyle(fontSize: 12)),
                    selected: _selectedFields.contains(key),
                    onSelected: (v) => setState(() {
                      if (v) { _selectedFields.add(key); } else { _selectedFields.remove(key); }
                    }),
                    visualDensity: VisualDensity.compact,
                  );
                }).toList(),
              ),
              const SizedBox(height: 12),
            ],
          );
        }),

        const SizedBox(height: 16),

        // Filters
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Filters', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'AND', label: Text('AND')),
                ButtonSegment(value: 'OR', label: Text('OR')),
              ],
              selected: {_filterLogic},
              onSelectionChanged: (v) => setState(() => _filterLogic = v.first),
              style: const ButtonStyle(visualDensity: VisualDensity.compact),
            ),
          ],
        ),
        const SizedBox(height: 8),
        ...(_filters.asMap().entries.map((entry) {
          final i = entry.key;
          final filter = entry.value;
          return Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      value: _allAvailableFields.contains(filter['field']) ? filter['field'] : null,
                      decoration: const InputDecoration(labelText: 'Field', isDense: true),
                      items: _allAvailableFields.map((f) => DropdownMenuItem(value: f, child: Text(f.split('.').last, style: const TextStyle(fontSize: 12)))).toList(),
                      onChanged: (v) => setState(() => filter['field'] = v ?? ''),
                    ),
                  ),
                  const SizedBox(width: 4),
                  SizedBox(
                    width: 70,
                    child: DropdownButtonFormField<String>(
                      value: filter['operator'],
                      decoration: const InputDecoration(labelText: 'Op', isDense: true),
                      items: _operators.map((o) => DropdownMenuItem(value: o, child: Text(_operatorLabels[o] ?? o, style: const TextStyle(fontSize: 11)))).toList(),
                      onChanged: (v) => setState(() => filter['operator'] = v ?? 'eq'),
                    ),
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: TextField(
                      decoration: const InputDecoration(labelText: 'Value', isDense: true),
                      controller: TextEditingController(text: filter['value']),
                      onChanged: (v) => filter['value'] = v,
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, size: 18),
                    onPressed: () => setState(() => _filters.removeAt(i)),
                  ),
                ],
              ),
            ),
          );
        })),
        TextButton.icon(
          onPressed: () => setState(() => _filters.add({'source': '', 'field': '', 'operator': 'eq', 'value': ''})),
          icon: const Icon(Icons.add, size: 18),
          label: const Text('Add filter'),
        ),
      ],
    );
  }

  Widget _buildPreviewStep() {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Save fields
        TextField(controller: _nameCtl,
            decoration: const InputDecoration(labelText: 'Report name *', border: OutlineInputBorder())),
        const SizedBox(height: 12),
        TextField(controller: _descCtl, maxLines: 2,
            decoration: const InputDecoration(labelText: 'Description', border: OutlineInputBorder())),
        const SizedBox(height: 16),

        // Preview
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Preview', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
            OutlinedButton.icon(
              onPressed: _previewing ? null : _runPreview,
              icon: _previewing
                  ? const SizedBox(height: 14, width: 14, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.play_arrow, size: 18),
              label: const Text('Run preview'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (_previewResult != null)
          _buildPreviewTable()
        else
          Card(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Center(child: Text('Click "Run preview" to see your data',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant))),
            ),
          ),
      ],
    );
  }

  Widget _buildPreviewTable() {
    final columns = List<String>.from(_previewResult!['columns'] ?? []);
    final rows = List<Map<String, dynamic>>.from(_previewResult!['rows'] ?? []);

    if (rows.isEmpty) return const Card(child: Padding(padding: EdgeInsets.all(16), child: Text('No data')));

    return Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text('${rows.length} rows', style: Theme.of(context).textTheme.bodySmall),
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              columnSpacing: 20,
              columns: columns.map((c) => DataColumn(label: Text(c.split('.').last,
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12)))).toList(),
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
}

class _StepDot extends StatelessWidget {
  final String label;
  final int index;
  final int current;

  const _StepDot({required this.label, required this.index, required this.current});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isActive = index <= current;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        CircleAvatar(
          radius: 14,
          backgroundColor: isActive ? theme.colorScheme.primary : theme.colorScheme.surfaceContainerHighest,
          child: Text('${index + 1}',
              style: TextStyle(fontSize: 12, color: isActive ? theme.colorScheme.onPrimary : theme.colorScheme.onSurfaceVariant,
                  fontWeight: FontWeight.bold)),
        ),
        const SizedBox(height: 4),
        Text(label, style: TextStyle(fontSize: 10,
            color: isActive ? theme.colorScheme.primary : theme.colorScheme.onSurfaceVariant)),
      ],
    );
  }
}
