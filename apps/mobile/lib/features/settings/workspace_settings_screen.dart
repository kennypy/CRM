import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';

class WorkspaceSettingsScreen extends ConsumerStatefulWidget {
  const WorkspaceSettingsScreen({super.key});

  @override
  ConsumerState<WorkspaceSettingsScreen> createState() => _WorkspaceSettingsScreenState();
}

class _WorkspaceSettingsScreenState extends ConsumerState<WorkspaceSettingsScreen> {
  Map<String, dynamic>? _tenant;
  bool _loading = true;
  bool _saving = false;
  late TextEditingController _nameCtl;
  bool _dirty = false;

  @override
  void initState() {
    super.initState();
    _nameCtl = TextEditingController();
    _loadTenant();
  }

  @override
  void dispose() {
    _nameCtl.dispose();
    super.dispose();
  }

  Future<void> _loadTenant() async {
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.tenant);
      if (mounted) {
        setState(() {
          _tenant = res.data['data'];
          _nameCtl.text = _tenant?['name'] ?? '';
        });
      }
    } catch (_) {}
    finally { if (mounted) setState(() => _loading = false); }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await ApiClient.instance.dio.patch(Endpoints.tenant, data: {
        'name': _nameCtl.text.trim(),
      });
      if (mounted) {
        setState(() => _dirty = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Workspace updated')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to update workspace')),
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
        title: const Text('Workspace'),
        actions: [
          if (_dirty)
            TextButton(
              onPressed: _saving ? null : _save,
              child: _saving
                  ? const SizedBox(height: 16, width: 16,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Save'),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                TextFormField(
                  controller: _nameCtl,
                  decoration: const InputDecoration(
                    labelText: 'Workspace name',
                    prefixIcon: Icon(Icons.business),
                  ),
                  onChanged: (_) { if (!_dirty) setState(() => _dirty = true); },
                ),
                const SizedBox(height: 16),
                Card(
                  child: Column(
                    children: [
                      _ReadOnlyTile(label: 'Slug', value: _tenant?['slug'] ?? '-'),
                      const Divider(height: 1),
                      _ReadOnlyTile(label: 'Plan', value: (_tenant?['plan'] ?? 'starter').toString().toUpperCase()),
                      const Divider(height: 1),
                      _ReadOnlyTile(label: 'Currency', value: _tenant?['defaultCurrency'] ?? _tenant?['default_currency'] ?? 'USD'),
                      const Divider(height: 1),
                      _ReadOnlyTile(label: 'Timezone', value: _tenant?['timezone'] ?? 'UTC'),
                      const Divider(height: 1),
                      _ReadOnlyTile(label: 'Region', value: _tenant?['dataRegion'] ?? _tenant?['data_region'] ?? 'us'),
                    ],
                  ),
                ),
              ],
            ),
    );
  }
}

class _ReadOnlyTile extends StatelessWidget {
  final String label;
  final String value;

  const _ReadOnlyTile({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      title: Text(label, style: Theme.of(context).textTheme.bodySmall
          ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
      trailing: Text(value, style: Theme.of(context).textTheme.bodyMedium),
    );
  }
}
