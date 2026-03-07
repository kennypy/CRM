import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

const _activityIcons = {
  'call': Icons.phone,
  'email': Icons.email_outlined,
  'meeting': Icons.people_outlined,
  'note': Icons.note_outlined,
  'task': Icons.task_alt,
};

const _activityColors = {
  'call': Colors.blue,
  'email': Colors.green,
  'meeting': Colors.purple,
  'note': Colors.orange,
  'task': Colors.teal,
};

class ActivitiesScreen extends ConsumerStatefulWidget {
  const ActivitiesScreen({super.key});

  @override
  ConsumerState<ActivitiesScreen> createState() => _ActivitiesScreenState();
}

class _ActivitiesScreenState extends ConsumerState<ActivitiesScreen> {
  List<Map<String, dynamic>> _activities = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadActivities();
  }

  Future<void> _loadActivities() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.activities, queryParameters: {'limit': '50'});
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['activities'] ?? []) : []);
      if (mounted) setState(() => _activities = List<Map<String, dynamic>>.from(items));
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load activities');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Activities')),
      floatingActionButton: FloatingActionButton(
        onPressed: () {},
        child: const Icon(Icons.add),
      ),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadActivities)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : _activities.isEmpty
                  ? const EmptyState(icon: Icons.timeline, title: 'No activities yet')
                  : RefreshIndicator(
                      onRefresh: _loadActivities,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(12),
                        itemCount: _activities.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (context, index) {
                          final a = _activities[index];
                          final type = a['type'] ?? 'note';
                          final icon = _activityIcons[type] ?? Icons.circle;
                          final color = _activityColors[type] ?? Colors.grey;

                          return Card(
                            child: ListTile(
                              leading: Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: color.withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Icon(icon, size: 20, color: color),
                              ),
                              title: Text(
                                a['subject'] ?? a['summary'] ?? type,
                                style: const TextStyle(fontWeight: FontWeight.w500),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              subtitle: Text(
                                [
                                  type,
                                  if (a['direction'] != null) a['direction'],
                                  if (a['occurred_at'] != null || a['created_at'] != null)
                                    _formatDate(a['occurred_at'] ?? a['created_at']),
                                ].join(' \u00b7 '),
                                maxLines: 1,
                              ),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }

  String _formatDate(String? iso) {
    if (iso == null) return '';
    try {
      final d = DateTime.parse(iso);
      final now = DateTime.now();
      final diff = now.difference(d);
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      if (diff.inHours < 24) return '${diff.inHours}h ago';
      if (diff.inDays < 7) return '${diff.inDays}d ago';
      return '${d.month}/${d.day}/${d.year}';
    } catch (_) {
      return '';
    }
  }
}
