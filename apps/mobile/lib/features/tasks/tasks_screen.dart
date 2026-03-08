import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';
import 'task_form_screen.dart';

const _statusFilters = ['all', 'pending', 'in_progress', 'completed'];
const _statusFilterLabels = {
  'all': 'All',
  'pending': 'Pending',
  'in_progress': 'In Progress',
  'completed': 'Completed',
};

class TasksScreen extends ConsumerStatefulWidget {
  const TasksScreen({super.key});

  @override
  ConsumerState<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends ConsumerState<TasksScreen> {
  List<Map<String, dynamic>> _tasks = [];
  bool _loading = true;
  String? _error;
  String _statusFilter = 'all';

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

  Future<void> _navigateToForm({Map<String, dynamic>? task}) async {
    final result = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => TaskFormScreen(task: task),
      ),
    );
    if (result == true) {
      _loadTasks();
    }
  }

  bool _isOverdue(Map<String, dynamic> task) {
    if (task['status'] == 'completed') return false;
    final dueDateStr = task['due_date'];
    if (dueDateStr == null) return false;
    final dueDate = DateTime.tryParse(dueDateStr.toString());
    if (dueDate == null) return false;
    final today = DateTime.now();
    final todayDate = DateTime(today.year, today.month, today.day);
    return dueDate.isBefore(todayDate);
  }

  List<Map<String, dynamic>> get _filteredTasks {
    if (_statusFilter == 'all') return _tasks;
    return _tasks.where((t) => t['status'] == _statusFilter).toList();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final filtered = _filteredTasks;

    return Scaffold(
      appBar: AppBar(title: const Text('Tasks')),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _navigateToForm(),
        child: const Icon(Icons.add),
      ),
      body: Column(
        children: [
          // Status filter chips
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: _statusFilters.map((filter) {
                final isSelected = _statusFilter == filter;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: FilterChip(
                    label: Text(_statusFilterLabels[filter] ?? filter),
                    selected: isSelected,
                    onSelected: (_) {
                      setState(() => _statusFilter = filter);
                    },
                  ),
                );
              }).toList(),
            ),
          ),

          // Task list
          Expanded(
            child: _error != null
                ? ErrorView(message: _error!, onRetry: _loadTasks)
                : _loading
                    ? const Center(child: CircularProgressIndicator())
                    : filtered.isEmpty
                        ? const EmptyState(
                            icon: Icons.task_alt, title: 'No tasks yet')
                        : RefreshIndicator(
                            onRefresh: _loadTasks,
                            child: ListView.separated(
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) =>
                                  const Divider(height: 1),
                              itemBuilder: (context, index) {
                                final t = filtered[index];
                                final isComplete = t['status'] == 'completed';
                                final priority = t['priority'] ?? 'normal';
                                final overdue = _isOverdue(t);
                                final priorityColor = priority == 'high'
                                    ? Colors.red
                                    : priority == 'low'
                                        ? Colors.grey
                                        : Colors.blue;

                                return ListTile(
                                  leading: IconButton(
                                    icon: Icon(
                                      isComplete
                                          ? Icons.check_circle
                                          : Icons.circle_outlined,
                                      color: isComplete
                                          ? Colors.green
                                          : theme
                                              .colorScheme.onSurfaceVariant,
                                    ),
                                    onPressed: () => _toggleTask(t),
                                  ),
                                  title: Text(
                                    t['title'] ?? 'Untitled',
                                    style: TextStyle(
                                      fontWeight: FontWeight.w500,
                                      decoration: isComplete
                                          ? TextDecoration.lineThrough
                                          : null,
                                      color: isComplete
                                          ? theme
                                              .colorScheme.onSurfaceVariant
                                          : overdue
                                              ? Colors.red
                                              : null,
                                    ),
                                  ),
                                  subtitle: Row(
                                    children: [
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 6, vertical: 1),
                                        decoration: BoxDecoration(
                                          color: priorityColor
                                              .withOpacity(0.1),
                                          borderRadius:
                                              BorderRadius.circular(4),
                                        ),
                                        child: Text(priority,
                                            style: TextStyle(
                                                fontSize: 11,
                                                color: priorityColor)),
                                      ),
                                      if (t['due_date'] != null) ...[
                                        const SizedBox(width: 8),
                                        Icon(Icons.calendar_today,
                                            size: 12,
                                            color: overdue
                                                ? Colors.red
                                                : theme.colorScheme
                                                    .onSurfaceVariant),
                                        const SizedBox(width: 4),
                                        Text(
                                          t['due_date']
                                              .toString()
                                              .substring(0, 10),
                                          style: overdue
                                              ? theme.textTheme.bodySmall
                                                  ?.copyWith(
                                                      color: Colors.red,
                                                      fontWeight:
                                                          FontWeight.bold)
                                              : theme.textTheme.bodySmall,
                                        ),
                                      ],
                                      if (overdue) ...[
                                        const SizedBox(width: 6),
                                        Container(
                                          padding: const EdgeInsets.symmetric(
                                              horizontal: 5, vertical: 1),
                                          decoration: BoxDecoration(
                                            color:
                                                Colors.red.withOpacity(0.1),
                                            borderRadius:
                                                BorderRadius.circular(4),
                                          ),
                                          child: const Text('OVERDUE',
                                              style: TextStyle(
                                                  fontSize: 10,
                                                  color: Colors.red,
                                                  fontWeight:
                                                      FontWeight.bold)),
                                        ),
                                      ],
                                    ],
                                  ),
                                  onTap: () => _navigateToForm(task: t),
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
