import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/error_view.dart';

class ImportScreen extends ConsumerStatefulWidget {
  const ImportScreen({super.key});

  @override
  ConsumerState<ImportScreen> createState() => _ImportScreenState();
}

class _ImportScreenState extends ConsumerState<ImportScreen> {
  String _entityType = 'contact';
  List<Map<String, dynamic>> _jobs = [];
  bool _loadingJobs = true;

  static const _entityTypes = {
    'contact': 'Contacts',
    'company': 'Companies',
    'deal': 'Deals',
    'activity': 'Activities',
    'task': 'Tasks',
  };

  static const _crmFields = {
    'contact': ['first_name', 'last_name', 'email', 'phone', 'title', 'company', 'linkedin_url'],
    'company': ['name', 'domain', 'industry', 'employee_count', 'revenue', 'phone', 'address'],
    'deal': ['name', 'value', 'stage', 'close_date', 'company', 'owner'],
    'activity': ['type', 'title', 'description', 'date', 'contact', 'company'],
    'task': ['title', 'description', 'due_date', 'priority', 'status', 'assignee'],
  };

  @override
  void initState() {
    super.initState();
    _loadJobs();
  }

  Future<void> _loadJobs() async {
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.import_);
      final data = res.data is List ? res.data : (res.data['data'] ?? []);
      if (mounted) setState(() => _jobs = List<Map<String, dynamic>>.from(data));
    } catch (_) {}
    finally { if (mounted) setState(() => _loadingJobs = false); }
  }

  void _showImportInfo() {
    showModalBottomSheet(
      context: context,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Import Data', style: Theme.of(ctx).textTheme.titleMedium
                ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            Text('To import data, prepare a CSV file with the following columns for $_entityType:'),
            const SizedBox(height: 12),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: (_crmFields[_entityType] ?? []).map((f) =>
                Chip(label: Text(f.replaceAll('_', ' '), style: const TextStyle(fontSize: 12)),
                    padding: EdgeInsets.zero, materialTapTargetSize: MaterialTapTargetSize.shrinkWrap),
              ).toList(),
            ),
            const SizedBox(height: 16),
            Text('Upload your CSV via the web app for full import wizard with column mapping and preview.',
                style: Theme.of(ctx).textTheme.bodySmall?.copyWith(
                    color: Theme.of(ctx).colorScheme.onSurfaceVariant)),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Import')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _showImportInfo,
        icon: const Icon(Icons.upload_file),
        label: const Text('Import'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Entity type selector
          Text('Entity Type', style: theme.textTheme.titleSmall
              ?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: _entityTypes.entries.map((e) => ChoiceChip(
              label: Text(e.value),
              selected: _entityType == e.key,
              onSelected: (_) => setState(() => _entityType = e.key),
            )).toList(),
          ),
          const SizedBox(height: 24),

          // Required fields for selected entity
          Text('Required Fields', style: theme.textTheme.titleSmall
              ?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Wrap(
                spacing: 6,
                runSpacing: 6,
                children: (_crmFields[_entityType] ?? []).map((f) =>
                  Chip(
                    label: Text(f.replaceAll('_', ' '),
                        style: const TextStyle(fontSize: 12)),
                    backgroundColor: theme.colorScheme.surfaceContainerHighest,
                  ),
                ).toList(),
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Import history
          Text('Import History', style: theme.textTheme.titleSmall
              ?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          if (_loadingJobs)
            const Center(child: CircularProgressIndicator())
          else if (_jobs.isEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text('No imports yet',
                    style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant)),
              ),
            )
          else
            ..._jobs.map((j) => Card(
              child: ListTile(
                leading: Icon(
                  j['status'] == 'completed' ? Icons.check_circle : Icons.hourglass_top,
                  color: j['status'] == 'completed' ? Colors.green : Colors.orange,
                ),
                title: Text(j['fileName'] ?? j['entity_type'] ?? 'Import'),
                subtitle: Text('${j['createdRows'] ?? 0} created, ${j['updatedRows'] ?? 0} updated'),
                trailing: Text(j['status'] ?? '',
                    style: const TextStyle(fontSize: 11)),
              ),
            )),
        ],
      ),
    );
  }
}
