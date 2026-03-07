import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

class TasksScreen extends ConsumerStatefulWidget {
  const TasksScreen({super.key});

  @override
  ConsumerState<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends ConsumerState<TasksScreen> {
  List<Map<String, dynamic>> _tasks = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadTasks();
  }

  Future<void> _loadTasks() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.tasks, queryParameters: {'limit': '50'});
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['tasks'] ?? []) : []);
      if (mounted) setState(() => _tasks = List<Map<String, dynamic>>.from(items));
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load tasks');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _toggleTask(Map<String, dynamic> task) async {
    final isComplete = task['status'] == 'completed';
    try {
      await ApiClient.instance.dio.patch(
        '${Endpoints.tasks}/${task['id']}',
        data: {'status': isComplete ? 'pending' : 'completed'},
      );
      _loadTasks();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to update task')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Tasks')),
      floatingActionButton: FloatingActionButton(
        onPressed: () {},
        child: const Icon(Icons.add),
      ),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadTasks)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : _tasks.isEmpty
                  ? const EmptyState(icon: Icons.task_alt, title: 'No tasks yet')
                  : RefreshIndicator(
                      onRefresh: _loadTasks,
                      child: ListView.separated(
                        itemCount: _tasks.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (context, index) {
                          final t = _tasks[index];
                          final isComplete = t['status'] == 'completed';
                          final priority = t['priority'] ?? 'normal';
                          final priorityColor = priority == 'high'
                              ? Colors.red
                              : priority == 'low'
                                  ? Colors.grey
                                  : Colors.blue;

                          return ListTile(
                            leading: IconButton(
                              icon: Icon(
                                isComplete ? Icons.check_circle : Icons.circle_outlined,
                                color: isComplete ? Colors.green : theme.colorScheme.onSurfaceVariant,
                              ),
                              onPressed: () => _toggleTask(t),
                            ),
                            title: Text(
                              t['title'] ?? 'Untitled',
                              style: TextStyle(
                                fontWeight: FontWeight.w500,
                                decoration: isComplete ? TextDecoration.lineThrough : null,
                                color: isComplete ? theme.colorScheme.onSurfaceVariant : null,
                              ),
                            ),
                            subtitle: Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                                  decoration: BoxDecoration(
                                    color: priorityColor.withOpacity(0.1),
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(priority,
                                      style: TextStyle(fontSize: 11, color: priorityColor)),
                                ),
                                if (t['due_date'] != null) ...[
                                  const SizedBox(width: 8),
                                  Icon(Icons.calendar_today, size: 12,
                                      color: theme.colorScheme.onSurfaceVariant),
                                  const SizedBox(width: 4),
                                  Text(t['due_date'].toString().substring(0, 10),
                                      style: theme.textTheme.bodySmall),
                                ],
                              ],
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
