import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';

class CustomObjectsSettingsScreen extends ConsumerStatefulWidget {
  const CustomObjectsSettingsScreen({super.key});

  @override
  ConsumerState<CustomObjectsSettingsScreen> createState() => _CustomObjectsSettingsScreenState();
}

class _CustomObjectsSettingsScreenState extends ConsumerState<CustomObjectsSettingsScreen> {
  List<Map<String, dynamic>> _objects = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadObjects();
  }

  Future<void> _loadObjects() async {
    setState(() => _loading = true);
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.customObjects);
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? []) : []);
      if (mounted) setState(() => _objects = List<Map<String, dynamic>>.from(items));
    } catch (_) {}
    finally { if (mounted) setState(() => _loading = false); }
  }

  void _showCreateDialog() {
    final keyCtl = TextEditingController();
    final labelCtl = TextEditingController();
    final pluralCtl = TextEditingController();
    final descCtl = TextEditingController();
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
                    Expanded(child: Text('Create Custom Object',
                        style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold))),
                    IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: keyCtl,
                  decoration: const InputDecoration(labelText: 'Object key (snake_case)', hintText: 'e.g. support_ticket'),
                  autocorrect: false,
                ),
                const SizedBox(height: 12),
                TextField(controller: labelCtl,
                    decoration: const InputDecoration(labelText: 'Label (singular)', hintText: 'e.g. Support Ticket')),
                const SizedBox(height: 12),
                TextField(controller: pluralCtl,
                    decoration: const InputDecoration(labelText: 'Label (plural)', hintText: 'e.g. Support Tickets')),
                const SizedBox(height: 12),
                TextField(controller: descCtl,
                    decoration: const InputDecoration(labelText: 'Description'), maxLines: 2),
                const SizedBox(height: 16),
                SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: submitting ? null : () async {
                      if (keyCtl.text.trim().isEmpty || labelCtl.text.trim().isEmpty) return;
                      setSheetState(() => submitting = true);
                      try {
                        await ApiClient.instance.dio.post(Endpoints.customObjects, data: {
                          'objectKey': keyCtl.text.trim(),
                          'objectLabel': labelCtl.text.trim(),
                          'objectLabelPlural': pluralCtl.text.trim().isNotEmpty
                              ? pluralCtl.text.trim() : '${labelCtl.text.trim()}s',
                          'description': descCtl.text.trim(),
                        });
                        if (ctx.mounted) {
                          Navigator.pop(ctx);
                          _loadObjects();
                        }
                      } catch (_) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Failed to create custom object')),
                          );
                        }
                      } finally {
                        if (ctx.mounted) setSheetState(() => submitting = false);
                      }
                    },
                    child: submitting
                        ? const SizedBox(height: 20, width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Create'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _deleteObject(String id) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Custom Object'),
        content: const Text('This will permanently delete the object and all its records.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Delete', style: TextStyle(color: Colors.red))),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ApiClient.instance.dio.delete('${Endpoints.customObjects}/$id');
      _loadObjects();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to delete custom object')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Custom Objects')),
      floatingActionButton: FloatingActionButton(
        onPressed: _showCreateDialog,
        child: const Icon(Icons.add),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _objects.isEmpty
              ? Center(child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.widgets_outlined, size: 48, color: theme.colorScheme.onSurfaceVariant),
                    const SizedBox(height: 12),
                    Text('No custom objects', style: theme.textTheme.bodyMedium),
                    const SizedBox(height: 8),
                    ElevatedButton(onPressed: _showCreateDialog, child: const Text('Create One')),
                  ],
                ))
              : RefreshIndicator(
                  onRefresh: _loadObjects,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(12),
                    itemCount: _objects.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final o = _objects[index];
                      return Card(
                        child: ListTile(
                          leading: Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: theme.colorScheme.primaryContainer,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Icon(Icons.widgets, size: 20, color: theme.colorScheme.primary),
                          ),
                          title: Text(o['objectLabel'] ?? o['object_label'] ?? '',
                              style: const TextStyle(fontWeight: FontWeight.w500)),
                          subtitle: Text(o['objectKey'] ?? o['object_key'] ?? ''),
                          trailing: IconButton(
                            icon: const Icon(Icons.delete_outline, size: 20, color: Colors.red),
                            onPressed: () => _deleteObject(o['id']),
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
