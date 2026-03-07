import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import 'package:go_router/go_router.dart';
import '../../shared/widgets/error_view.dart';

class ReportsScreen extends ConsumerStatefulWidget {
  const ReportsScreen({super.key});

  @override
  ConsumerState<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends ConsumerState<ReportsScreen> {
  List<Map<String, dynamic>> _reports = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadReports();
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

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => const Center(child: CircularProgressIndicator()),
    );

    try {
      final res = await ApiClient.instance.dio.post(
        '${Endpoints.reports}/run',
        data: {'spec': spec},
      );
      if (mounted) {
        Navigator.pop(context);
        _showResults(report['name'] ?? 'Report', res.data['data']);
      }
    } catch (_) {
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to run report')),
        );
      }
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
                  Text('${rows.length} rows',
                      style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(width: 8),
                  IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.pop(context),
                  ),
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
                        columns: columns.map((c) => DataColumn(label: Text(c))).toList(),
                        rows: rows.map((row) => DataRow(
                          cells: columns.map((c) => DataCell(Text('${row[c] ?? ''}'))).toList(),
                        )).toList(),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reports')),
      floatingActionButton: FloatingActionButton(
        onPressed: () async {
          final created = await context.push<bool>('/reports/new');
          if (created == true) _loadReports();
        },
        child: const Icon(Icons.add),
      ),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadReports)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : _reports.isEmpty
                  ? const EmptyState(icon: Icons.bar_chart, title: 'No saved reports')
                  : RefreshIndicator(
                      onRefresh: _loadReports,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(12),
                        itemCount: _reports.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (context, index) {
                          final r = _reports[index];
                          return Card(
                            child: ListTile(
                              leading: const Icon(Icons.bar_chart),
                              title: Text(r['name'] ?? 'Untitled',
                                  style: const TextStyle(fontWeight: FontWeight.w500)),
                              subtitle: Text(r['description'] ?? ''),
                              trailing: IconButton(
                                icon: const Icon(Icons.play_arrow),
                                onPressed: () => _runReport(r),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
