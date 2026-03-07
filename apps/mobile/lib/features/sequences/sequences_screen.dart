import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

class SequencesScreen extends ConsumerStatefulWidget {
  const SequencesScreen({super.key});

  @override
  ConsumerState<SequencesScreen> createState() => _SequencesScreenState();
}

class _SequencesScreenState extends ConsumerState<SequencesScreen> {
  List<Map<String, dynamic>> _sequences = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadSequences();
  }

  Future<void> _loadSequences() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.sequences);
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['sequences'] ?? []) : []);
      if (mounted) setState(() => _sequences = List<Map<String, dynamic>>.from(items));
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load sequences');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Sequences')),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadSequences)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : _sequences.isEmpty
                  ? const EmptyState(icon: Icons.autorenew, title: 'No sequences yet')
                  : RefreshIndicator(
                      onRefresh: _loadSequences,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(12),
                        itemCount: _sequences.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (context, index) {
                          final s = _sequences[index];
                          final status = s['status'] ?? 'draft';
                          final isActive = status == 'active';

                          return Card(
                            child: ListTile(
                              leading: Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: (isActive ? Colors.green : Colors.grey).withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Icon(Icons.autorenew,
                                    size: 20, color: isActive ? Colors.green : Colors.grey),
                              ),
                              title: Text(s['name'] ?? 'Untitled',
                                  style: const TextStyle(fontWeight: FontWeight.w500)),
                              subtitle: Text('${s['step_count'] ?? s['steps']?.length ?? 0} steps \u00b7 ${s['enrolled_count'] ?? 0} enrolled'),
                              trailing: Chip(
                                label: Text(status, style: const TextStyle(fontSize: 11)),
                                backgroundColor: isActive
                                    ? Colors.green.withOpacity(0.1)
                                    : theme.colorScheme.surfaceContainerHighest,
                              ),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
