import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/loading_indicator.dart';
import '../../shared/widgets/error_view.dart';
import '../../shared/widgets/empty_state.dart';

class CustomObjectsBrowserScreen extends ConsumerStatefulWidget {
  final String objectKey;

  const CustomObjectsBrowserScreen({super.key, required this.objectKey});

  @override
  ConsumerState<CustomObjectsBrowserScreen> createState() =>
      _CustomObjectsBrowserScreenState();
}

class _CustomObjectsBrowserScreenState
    extends ConsumerState<CustomObjectsBrowserScreen> {
  List<Map<String, dynamic>> _records = [];
  List<Map<String, dynamic>> _fields = [];
  bool _loading = true;
  String? _error;
  String _search = '';
  final _searchController = TextEditingController();

  // Pagination
  int _page = 1;
  int _limit = 50;
  int _total = 0;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        ApiClient.instance.dio.get(
          '${Endpoints.customObjects}/${widget.objectKey}/records',
          queryParameters: {'page': '$_page', 'limit': '$_limit'},
        ),
        ApiClient.instance.dio.get(
          Endpoints.customFields,
          queryParameters: {'entityType': 'custom_object', 'objectKey': widget.objectKey},
        ),
      ]);

      final recRes = results[0];
      final fieldRes = results[1];

      if (mounted) {
        setState(() {
          _records = List<Map<String, dynamic>>.from(recRes.data['data'] ?? []);
          final meta = recRes.data['meta'];
          if (meta != null) {
            _total = meta['total'] ?? 0;
            _page = meta['page'] ?? _page;
          }
          _fields = List<Map<String, dynamic>>.from(fieldRes.data['data'] ?? []);
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = 'Failed to load records');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> get _filtered {
    if (_search.isEmpty) return _records;
    final q = _search.toLowerCase();
    return _records.where((rec) {
      final data = rec['data'] as Map<String, dynamic>? ?? {};
      return data.values.any((v) => v.toString().toLowerCase().contains(q));
    }).toList();
  }

  int get _totalPages => (_total / _limit).ceil().clamp(1, 999);

  Future<void> _createRecord(Map<String, dynamic> formData) async {
    try {
      await ApiClient.instance.dio.post(
        '${Endpoints.customObjects}/${widget.objectKey}/records',
        data: {'data': formData},
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Record created')),
        );
        _loadData();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to create record')),
        );
      }
    }
  }

  Future<void> _updateRecord(String id, Map<String, dynamic> formData) async {
    try {
      await ApiClient.instance.dio.patch(
        '${Endpoints.customObjects}/${widget.objectKey}/records/$id',
        data: {'data': formData},
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Record updated')),
        );
        _loadData();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to update record')),
        );
      }
    }
  }

  Future<void> _deleteRecord(String id) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete record?'),
        content: const Text('This action cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
    if (confirm != true) return;

    try {
      await ApiClient.instance.dio.delete(
        '${Endpoints.customObjects}/${widget.objectKey}/records/$id',
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Record deleted')),
        );
        _loadData();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to delete record')),
        );
      }
    }
  }

  void _openRecordForm({String? editId, Map<String, dynamic>? initialData}) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.85,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        expand: false,
        builder: (_, scrollController) => _RecordFormSheet(
          fields: _fields,
          editId: editId,
          initialData: initialData ?? {},
          scrollController: scrollController,
          onSave: (data) {
            Navigator.pop(context);
            if (editId != null) {
              _updateRecord(editId, data);
            } else {
              _createRecord(data);
            }
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final displayName = widget.objectKey.replaceAll('_', ' ');

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              displayName[0].toUpperCase() + displayName.substring(1),
            ),
            Text(
              '$_total record${_total != 1 ? 's' : ''}',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadData),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Search records...',
                prefixIcon: const Icon(Icons.search, size: 20),
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 8),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide.none,
                ),
                filled: true,
                fillColor: theme.colorScheme.surfaceContainerHighest.withOpacity(0.5),
                suffixIcon: _search.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear, size: 18),
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _search = '');
                        },
                      )
                    : null,
              ),
              onChanged: (v) => setState(() => _search = v),
            ),
          ),
        ),
      ),
      body: _buildBody(theme),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _openRecordForm(),
        child: const Icon(Icons.add),
      ),
    );
  }

  Widget _buildBody(ThemeData theme) {
    if (_loading) return const LoadingIndicator();
    if (_error != null) return ErrorView(message: _error!, onRetry: _loadData);

    final records = _filtered;

    if (records.isEmpty) {
      return EmptyState(
        icon: Icons.dataset_outlined,
        title: _search.isNotEmpty ? 'No matching records' : 'No records yet',
        subtitle: _search.isNotEmpty
            ? 'Try a different search term'
            : 'Tap + to create your first record',
      );
    }

    // Determine which fields to show on cards (first 3-4)
    final displayFields = _fields.take(4).toList();

    return Column(
      children: [
        Expanded(
          child: RefreshIndicator(
            onRefresh: _loadData,
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: records.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) {
                final rec = records[i];
                final data = rec['data'] as Map<String, dynamic>? ?? {};
                final createdAt = rec['createdAt'] ?? rec['created_at'];

                return Card(
                  child: InkWell(
                    borderRadius: BorderRadius.circular(12),
                    onTap: () => _openRecordForm(
                      editId: rec['id'],
                      initialData: data,
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // First field as title if available
                          if (displayFields.isNotEmpty)
                            Text(
                              '${data[displayFields[0]['fieldKey']] ?? 'Untitled'}',
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                                fontSize: 15,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          const SizedBox(height: 6),

                          // Remaining fields
                          ...displayFields.skip(1).map((field) {
                            final key = field['fieldKey'];
                            final label = field['fieldLabel'] ?? key;
                            final value = data[key];
                            final displayValue = _formatFieldValue(field, value);
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 2),
                              child: Row(
                                children: [
                                  SizedBox(
                                    width: 100,
                                    child: Text(
                                      '$label:',
                                      style: theme.textTheme.bodySmall?.copyWith(
                                        color: theme.colorScheme.onSurfaceVariant,
                                      ),
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                  const SizedBox(width: 4),
                                  Expanded(
                                    child: Text(
                                      displayValue,
                                      style: theme.textTheme.bodySmall,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                ],
                              ),
                            );
                          }),

                          const SizedBox(height: 6),
                          Row(
                            children: [
                              if (createdAt != null)
                                Text(
                                  _fmtDate(createdAt),
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant,
                                    fontSize: 11,
                                  ),
                                ),
                              const Spacer(),
                              InkWell(
                                onTap: () => _deleteRecord(rec['id']),
                                child: Icon(
                                  Icons.delete_outline,
                                  size: 18,
                                  color: theme.colorScheme.error.withOpacity(0.7),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ),

        // Pagination controls
        if (_totalPages > 1)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                IconButton(
                  icon: const Icon(Icons.chevron_left),
                  onPressed: _page > 1
                      ? () {
                          setState(() => _page--);
                          _loadData();
                        }
                      : null,
                ),
                Text(
                  'Page $_page of $_totalPages',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.chevron_right),
                  onPressed: _page < _totalPages
                      ? () {
                          setState(() => _page++);
                          _loadData();
                        }
                      : null,
                ),
              ],
            ),
          ),
      ],
    );
  }

  String _formatFieldValue(Map<String, dynamic> field, dynamic value) {
    if (value == null) return '-';
    final type = field['fieldType'] ?? 'text';
    switch (type) {
      case 'boolean':
        return value == true ? 'Yes' : 'No';
      case 'date':
        return _fmtDate(value.toString());
      case 'currency':
        final n = num.tryParse(value.toString());
        return n != null ? '\$${n.toStringAsFixed(2)}' : value.toString();
      default:
        return value.toString();
    }
  }

  String _fmtDate(String? iso) {
    if (iso == null || iso.isEmpty) return '';
    try {
      final dt = DateTime.parse(iso);
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return iso;
    }
  }
}

// ── Record Form Sheet ─────────────────────────────────────────────────

class _RecordFormSheet extends StatefulWidget {
  final List<Map<String, dynamic>> fields;
  final String? editId;
  final Map<String, dynamic> initialData;
  final ScrollController scrollController;
  final void Function(Map<String, dynamic> data) onSave;

  const _RecordFormSheet({
    required this.fields,
    required this.editId,
    required this.initialData,
    required this.scrollController,
    required this.onSave,
  });

  @override
  State<_RecordFormSheet> createState() => _RecordFormSheetState();
}

class _RecordFormSheetState extends State<_RecordFormSheet> {
  late Map<String, dynamic> _formData;
  final _formKey = GlobalKey<FormState>();

  @override
  void initState() {
    super.initState();
    _formData = Map<String, dynamic>.from(widget.initialData);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      children: [
        // Header
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  widget.editId != null ? 'Edit Record' : 'New Record',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              TextButton(
                onPressed: () {
                  if (_formKey.currentState?.validate() ?? false) {
                    widget.onSave(_formData);
                  }
                },
                child: Text(widget.editId != null ? 'Save' : 'Create'),
              ),
              IconButton(
                icon: const Icon(Icons.close),
                onPressed: () => Navigator.pop(context),
              ),
            ],
          ),
        ),
        const Divider(height: 1),

        // Form fields
        Expanded(
          child: Form(
            key: _formKey,
            child: ListView(
              controller: widget.scrollController,
              padding: const EdgeInsets.all(16),
              children: widget.fields.map((field) {
                final key = field['fieldKey'] as String? ?? '';
                final label = field['fieldLabel'] as String? ?? key;
                final type = field['fieldType'] as String? ?? 'text';
                final isRequired = field['isRequired'] == true;
                final options = field['options'] as List? ?? [];

                return Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: _buildFieldInput(
                    theme: theme,
                    fieldKey: key,
                    label: label,
                    type: type,
                    isRequired: isRequired,
                    options: options,
                  ),
                );
              }).toList(),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildFieldInput({
    required ThemeData theme,
    required String fieldKey,
    required String label,
    required String type,
    required bool isRequired,
    required List options,
  }) {
    switch (type) {
      case 'boolean':
        return SwitchListTile(
          title: Text(label),
          subtitle: isRequired ? const Text('Required', style: TextStyle(fontSize: 11)) : null,
          value: _formData[fieldKey] == true,
          onChanged: (v) => setState(() => _formData[fieldKey] = v),
          contentPadding: EdgeInsets.zero,
        );

      case 'number':
      case 'currency':
        return TextFormField(
          initialValue: _formData[fieldKey]?.toString() ?? '',
          decoration: InputDecoration(
            labelText: '$label${isRequired ? ' *' : ''}',
            border: const OutlineInputBorder(),
            prefixText: type == 'currency' ? '\$ ' : null,
          ),
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          validator: isRequired
              ? (v) => (v == null || v.isEmpty) ? '$label is required' : null
              : null,
          onChanged: (v) {
            final n = num.tryParse(v);
            _formData[fieldKey] = n ?? v;
          },
        );

      case 'date':
        final currentValue = _formData[fieldKey]?.toString() ?? '';
        return TextFormField(
          initialValue: currentValue,
          decoration: InputDecoration(
            labelText: '$label${isRequired ? ' *' : ''}',
            border: const OutlineInputBorder(),
            suffixIcon: IconButton(
              icon: const Icon(Icons.calendar_today, size: 18),
              onPressed: () async {
                final date = await showDatePicker(
                  context: context,
                  initialDate: DateTime.tryParse(currentValue) ?? DateTime.now(),
                  firstDate: DateTime(2000),
                  lastDate: DateTime(2100),
                );
                if (date != null) {
                  setState(() {
                    _formData[fieldKey] = date.toIso8601String().split('T')[0];
                  });
                }
              },
            ),
          ),
          validator: isRequired
              ? (v) => (v == null || v.isEmpty) ? '$label is required' : null
              : null,
          onChanged: (v) => _formData[fieldKey] = v,
        );

      case 'enum':
        final optionsList = options.map<Map<String, String>>((o) {
          if (o is Map) {
            return {
              'value': (o['value'] ?? '').toString(),
              'label': (o['label'] ?? o['value'] ?? '').toString(),
            };
          }
          return {'value': o.toString(), 'label': o.toString()};
        }).toList();

        final currentVal = _formData[fieldKey]?.toString();
        final validValue = optionsList.any((o) => o['value'] == currentVal) ? currentVal : null;

        return DropdownButtonFormField<String>(
          value: validValue,
          decoration: InputDecoration(
            labelText: '$label${isRequired ? ' *' : ''}',
            border: const OutlineInputBorder(),
          ),
          items: [
            const DropdownMenuItem(value: null, child: Text('Select...')),
            ...optionsList.map((o) => DropdownMenuItem(
              value: o['value'],
              child: Text(o['label']!),
            )),
          ],
          validator: isRequired
              ? (v) => (v == null || v.isEmpty) ? '$label is required' : null
              : null,
          onChanged: (v) => setState(() => _formData[fieldKey] = v),
        );

      default: // text, url, email, etc.
        return TextFormField(
          initialValue: _formData[fieldKey]?.toString() ?? '',
          decoration: InputDecoration(
            labelText: '$label${isRequired ? ' *' : ''}',
            border: const OutlineInputBorder(),
          ),
          maxLines: type == 'textarea' ? 3 : 1,
          keyboardType: type == 'email'
              ? TextInputType.emailAddress
              : type == 'url'
                  ? TextInputType.url
                  : TextInputType.text,
          validator: isRequired
              ? (v) => (v == null || v.isEmpty) ? '$label is required' : null
              : null,
          onChanged: (v) => _formData[fieldKey] = v,
        );
    }
  }
}
