import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

class WorkflowsScreen extends ConsumerStatefulWidget {
  const WorkflowsScreen({super.key});

  @override
  ConsumerState<WorkflowsScreen> createState() => _WorkflowsScreenState();
}

class _WorkflowsScreenState extends ConsumerState<WorkflowsScreen> {
  List<Map<String, dynamic>> _workflows = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadWorkflows();
  }

  Future<void> _loadWorkflows() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.workflows);
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['workflows'] ?? []) : []);
      if (mounted) setState(() => _workflows = List<Map<String, dynamic>>.from(items));
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load workflows');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _toggleWorkflow(Map<String, dynamic> wf) async {
    final isActive = wf['is_active'] == true || wf['isActive'] == true;
    try {
      await ApiClient.instance.dio.patch(
        '${Endpoints.workflows}/${wf['id']}',
        data: {'isActive': !isActive},
      );
      _loadWorkflows();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to update workflow')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Workflows')),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadWorkflows)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : _workflows.isEmpty
                  ? const EmptyState(icon: Icons.account_tree, title: 'No workflows yet')
                  : RefreshIndicator(
                      onRefresh: _loadWorkflows,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(12),
                        itemCount: _workflows.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (context, index) {
                          final wf = _workflows[index];
                          final isActive = wf['is_active'] == true || wf['isActive'] == true;

                          return Card(
                            child: ListTile(
                              leading: Icon(Icons.account_tree,
                                  color: isActive ? Colors.green : Colors.grey),
                              title: Text(wf['name'] ?? 'Untitled',
                                  style: const TextStyle(fontWeight: FontWeight.w500)),
                              subtitle: Text(wf['description'] ?? ''),
                              trailing: Switch(
                                value: isActive,
                                onChanged: (_) => _toggleWorkflow(wf),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
