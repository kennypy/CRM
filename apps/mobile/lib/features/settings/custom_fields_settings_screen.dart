import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';

class CustomFieldsSettingsScreen extends ConsumerStatefulWidget {
  const CustomFieldsSettingsScreen({super.key});

  @override
  ConsumerState<CustomFieldsSettingsScreen> createState() => _CustomFieldsSettingsScreenState();
}

class _CustomFieldsSettingsScreenState extends ConsumerState<CustomFieldsSettingsScreen> {
  List<Map<String, dynamic>> _fields = [];
  bool _loading = true;
  String _entityType = 'contact';

  @override
  void initState() {
    super.initState();
    _loadFields();
  }

  Future<void> _loadFields() async {
    setState(() => _loading = true);
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.customFields,
          queryParameters: {'entityType': _entityType});
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? []) : []);
      if (mounted) setState(() => _fields = List<Map<String, dynamic>>.from(items));
    } catch (_) {}
    finally { if (mounted) setState(() => _loading = false); }
  }

  void _showCreateFieldDialog() {
    final keyCtl = TextEditingController();
    final labelCtl = TextEditingController();
    String fieldType = 'text';
    bool isRequired = false;
    final optionsCtl = TextEditingController();
    bool submitting = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(child: Text('Add Custom Field',
                        style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold))),
                    IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: keyCtl,
                  decoration: const InputDecoration(labelText: 'Field key (snake_case)', hintText: 'e.g. custom_score'),
                  autocorrect: false,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: labelCtl,
                  decoration: const InputDecoration(labelText: 'Display label', hintText: 'e.g. Custom Score'),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: fieldType,
                  decoration: const InputDecoration(labelText: 'Field type'),
                  items: const [
                    DropdownMenuItem(value: 'text', child: Text('Text')),
                    DropdownMenuItem(value: 'number', child: Text('Number')),
                    DropdownMenuItem(value: 'date', child: Text('Date')),
                    DropdownMenuItem(value: 'datetime', child: Text('Date & Time')),
                    DropdownMenuItem(value: 'boolean', child: Text('Boolean')),
                    DropdownMenuItem(value: 'enum', child: Text('Single Select')),
                    DropdownMenuItem(value: 'multi_enum', child: Text('Multi Select')),
                    DropdownMenuItem(value: 'url', child: Text('URL')),
                    DropdownMenuItem(value: 'email', child: Text('Email')),
                    DropdownMenuItem(value: 'phone', child: Text('Phone')),
                    DropdownMenuItem(value: 'currency', child: Text('Currency')),
                  ],
                  onChanged: (v) => setSheetState(() => fieldType = v!),
                ),
                if (fieldType == 'enum' || fieldType == 'multi_enum') ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: optionsCtl,
                    decoration: const InputDecoration(
                      labelText: 'Options',
                      hintText: 'option1, option2, option3',
                      helperText: 'Comma-separated values',
                    ),
                  ),
                ],
                SwitchListTile(
                  title: const Text('Required'),
                  value: isRequired,
                  onChanged: (v) => setSheetState(() => isRequired = v),
                  contentPadding: EdgeInsets.zero,
                ),
                const SizedBox(height: 16),
                SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: submitting ? null : () async {
                      if (keyCtl.text.trim().isEmpty || labelCtl.text.trim().isEmpty) return;
                      setSheetState(() => submitting = true);
                      try {
                        final data = {
                          'entityType': _entityType,
                          'fieldKey': keyCtl.text.trim(),
                          'fieldLabel': labelCtl.text.trim(),
                          'fieldType': fieldType,
                          'isRequired': isRequired,
                        };
                        if (fieldType == 'enum' || fieldType == 'multi_enum') {
                          data['options'] = optionsCtl.text.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
                        }
                        await ApiClient.instance.dio.post(Endpoints.customFields, data: data);
                        if (ctx.mounted) {
                          Navigator.pop(ctx);
                          _loadFields();
                        }
                      } catch (_) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Failed to create field')),
                          );
                        }
                      } finally {
                        if (ctx.mounted) setSheetState(() => submitting = false);
                      }
                    },
                    child: submitting
                        ? const SizedBox(height: 20, width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Create Field'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _deleteField(String id) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Field'),
        content: const Text('Are you sure? This will remove the field from all records.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Delete', style: TextStyle(color: Colors.red))),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ApiClient.instance.dio.delete('${Endpoints.customFields}/$id');
      _loadFields();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to delete field')),
        );
      }
    }
  }

  IconData _typeIcon(String type) {
    switch (type) {
      case 'number': return Icons.numbers;
      case 'date': case 'datetime': return Icons.calendar_today;
      case 'boolean': return Icons.toggle_on_outlined;
      case 'enum': case 'multi_enum': return Icons.list;
      case 'url': return Icons.link;
      case 'email': return Icons.email_outlined;
      case 'phone': return Icons.phone_outlined;
      case 'currency': return Icons.attach_money;
      default: return Icons.text_fields;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Custom Fields')),
      floatingActionButton: FloatingActionButton(
        onPressed: _showCreateFieldDialog,
        child: const Icon(Icons.add),
      ),
      body: Column(
        children: [
          // Entity type selector
          SizedBox(
            height: 50,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              children: ['contact', 'company', 'deal', 'activity', 'task'].map((e) =>
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(e[0].toUpperCase() + e.substring(1)),
                    selected: _entityType == e,
                    onSelected: (_) {
                      setState(() => _entityType = e);
                      _loadFields();
                    },
                  ),
                ),
              ).toList(),
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _fields.isEmpty
                    ? Center(child: Text('No custom fields for ${_entityType}s',
                        style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)))
                    : RefreshIndicator(
                        onRefresh: _loadFields,
                        child: ListView.separated(
                          padding: const EdgeInsets.all(12),
                          itemCount: _fields.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 8),
                          itemBuilder: (context, index) {
                            final f = _fields[index];
                            final type = f['fieldType'] ?? f['field_type'] ?? 'text';
                            final required = f['isRequired'] ?? f['is_required'] ?? false;

                            return Card(
                              child: ListTile(
                                leading: Icon(_typeIcon(type), size: 20),
                                title: Text(f['fieldLabel'] ?? f['field_label'] ?? '',
                                    style: const TextStyle(fontWeight: FontWeight.w500)),
                                subtitle: Text('${f['fieldKey'] ?? f['field_key'] ?? ''} \u00b7 $type${required ? ' \u00b7 required' : ''}'),
                                trailing: IconButton(
                                  icon: const Icon(Icons.delete_outline, size: 20, color: Colors.red),
                                  onPressed: () => _deleteField(f['id']),
                                ),
                              ),
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
