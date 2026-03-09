import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../core/auth/auth_provider.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';
import 'task_form_screen.dart';

enum _FilterTab { all, mine, overdue, done }

const _filterLabels = {
  _FilterTab.all: 'All',
  _FilterTab.mine: 'Mine',
  _FilterTab.overdue: 'Overdue',
  _FilterTab.done: 'Done',
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
  _FilterTab _activeFilter = _FilterTab.all;

  @override
  void initState() {
    super.initState();
    _loadTasks();
  }

  Future<void> _loadTasks() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await ApiClient.instance.dio
          .get(Endpoints.tasks, queryParameters: {'limit': '50'});
      final data = res.data['data'];
      final items = data is List
          ? data
          : (data is Map
              ? (data['items'] ?? data['tasks'] ?? [])
              : []);
      if (mounted) {
        setState(() => _tasks = List<Map<String, dynamic>>.from(items));
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load tasks');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _toggleTask(Map<String, dynamic> task) async {
    final isComplete = task['status'] == 'completed';
    final newStatus = isComplete ? 'pending' : 'completed';

    // Optimistic update
    setState(() {
      final idx = _tasks.indexWhere((t) => t['id'] == task['id']);
      if (idx != -1) {
        _tasks[idx] = Map<String, dynamic>.from(_tasks[idx])
          ..['status'] = newStatus;
      }
    });

    try {
      await ApiClient.instance.dio.patch(
        '${Endpoints.tasks}/${task['id']}',
        data: {'status': newStatus},
      );
      _loadTasks();
    } catch (_) {
      // Revert on failure
      setState(() {
        final idx = _tasks.indexWhere((t) => t['id'] == task['id']);
        if (idx != -1) {
          _tasks[idx] = Map<String, dynamic>.from(_tasks[idx])
            ..['status'] = task['status'];
        }
      });
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

  int get _overdueCount => _tasks.where(_isOverdue).length;

  String _currentUserId() {
    final authState = ref.read(authProvider);
    return authState.user?.id ?? '';
  }

  List<Map<String, dynamic>> get _filteredTasks {
    switch (_activeFilter) {
      case _FilterTab.all:
        return _tasks.where((t) => t['status'] != 'completed').toList();
      case _FilterTab.mine:
        final uid = _currentUserId();
        return _tasks.where((t) {
          final assigneeId = t['assignee_id'] ?? t['assigneeId'] ?? '';
          return assigneeId == uid && t['status'] != 'completed';
        }).toList();
      case _FilterTab.overdue:
        return _tasks.where(_isOverdue).toList();
      case _FilterTab.done:
        return _tasks.where((t) => t['status'] == 'completed').toList();
    }
  }

  /// Returns a human-readable relative due date string.
  String _relativeDueDate(String dueDateStr) {
    final dueDate = DateTime.tryParse(dueDateStr);
    if (dueDate == null) return dueDateStr.substring(0, 10);

    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final due = DateTime(dueDate.year, dueDate.month, dueDate.day);
    final diff = due.difference(today).inDays;

    if (diff == 0) return 'due today';
    if (diff == 1) return 'due tomorrow';
    if (diff == -1) return '1 day overdue';
    if (diff > 1) return 'due in $diff days';
    return '${diff.abs()} days overdue';
  }

  /// Extract assignee display name from task data.
  String? _assigneeName(Map<String, dynamic> task) {
    // Try nested assignee object first
    final assignee = task['assignee'];
    if (assignee is Map) {
      final name = assignee['fullName'] ??
          assignee['full_name'] ??
          '${assignee['firstName'] ?? assignee['first_name'] ?? ''} ${assignee['lastName'] ?? assignee['last_name'] ?? ''}'
              .trim();
      if (name is String && name.isNotEmpty) return name;
    }
    // Fallback to flat field
    final name = task['assignee_name'] ?? task['assigneeName'];
    if (name is String && name.isNotEmpty) return name;
    return null;
  }

  /// Build linked entity widget (Deal / Contact / Company).
  Widget? _linkedEntityChip(Map<String, dynamic> task, ThemeData theme) {
    String? entityName;
    IconData? entityIcon;

    final deal = task['deal'];
    final contact = task['contact'];
    final company = task['company'];
    final linkedEntityType =
        task['linked_entity_type'] ?? task['linkedEntityType'];
    final linkedEntityName =
        task['linked_entity_name'] ?? task['linkedEntityName'];

    if (deal is Map && (deal['name'] ?? deal['title']) != null) {
      entityName = deal['name'] ?? deal['title'];
      entityIcon = Icons.handshake_outlined;
    } else if (contact is Map &&
        (contact['name'] ?? contact['fullName'] ?? contact['full_name']) !=
            null) {
      entityName =
          contact['name'] ?? contact['fullName'] ?? contact['full_name'];
      entityIcon = Icons.person_outline;
    } else if (company is Map && company['name'] != null) {
      entityName = company['name'];
      entityIcon = Icons.business_outlined;
    } else if (linkedEntityType != null && linkedEntityName != null) {
      entityName = linkedEntityName;
      switch (linkedEntityType) {
        case 'deal':
          entityIcon = Icons.handshake_outlined;
          break;
        case 'contact':
          entityIcon = Icons.person_outline;
          break;
        case 'company':
          entityIcon = Icons.business_outlined;
          break;
        default:
          entityIcon = Icons.link;
      }
    } else if (task['deal_id'] != null || task['dealId'] != null) {
      entityName = task['deal_name'] ?? task['dealName'];
      entityIcon = Icons.handshake_outlined;
    } else if (task['contact_id'] != null || task['contactId'] != null) {
      entityName = task['contact_name'] ?? task['contactName'];
      entityIcon = Icons.person_outline;
    } else if (task['company_id'] != null || task['companyId'] != null) {
      entityName = task['company_name'] ?? task['companyName'];
      entityIcon = Icons.business_outlined;
    }

    if (entityName == null || entityIcon == null) return null;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(entityIcon, size: 12, color: theme.colorScheme.onSurfaceVariant),
        const SizedBox(width: 3),
        Flexible(
          child: Text(
            entityName,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final filtered = _filteredTasks;
    final overdueCount = _overdueCount;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            const Text('Tasks'),
            if (overdueCount > 0) ...[
              const SizedBox(width: 8),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: Colors.red,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  '$overdueCount',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _navigateToForm(),
        child: const Icon(Icons.add),
      ),
      body: Column(
        children: [
          // Filter tabs
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: _FilterTab.values.map((filter) {
                final isSelected = _activeFilter == filter;
                final label = _filterLabels[filter] ?? '';
                // Show count badge on Overdue tab
                final showBadge =
                    filter == _FilterTab.overdue && overdueCount > 0;

                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: FilterChip(
                    label: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(label),
                        if (showBadge) ...[
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 5, vertical: 1),
                            decoration: BoxDecoration(
                              color: Colors.red.withOpacity(0.9),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              '$overdueCount',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    selected: isSelected,
                    onSelected: (_) {
                      setState(() => _activeFilter = filter);
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
                                return _TaskCard(
                                  task: t,
                                  isOverdue: _isOverdue(t),
                                  assigneeName: _assigneeName(t),
                                  relativeDue: t['due_date'] != null
                                      ? _relativeDueDate(
                                          t['due_date'].toString())
                                      : null,
                                  linkedEntityWidget:
                                      _linkedEntityChip(t, theme),
                                  onToggle: () => _toggleTask(t),
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

/// Individual task card with assignee, linked entity, and relative due date.
class _TaskCard extends StatelessWidget {
  final Map<String, dynamic> task;
  final bool isOverdue;
  final String? assigneeName;
  final String? relativeDue;
  final Widget? linkedEntityWidget;
  final VoidCallback onToggle;
  final VoidCallback onTap;

  const _TaskCard({
    required this.task,
    required this.isOverdue,
    this.assigneeName,
    this.relativeDue,
    this.linkedEntityWidget,
    required this.onToggle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isComplete = task['status'] == 'completed';
    final priority = task['priority'] ?? 'medium';
    final priorityColor = priority == 'high'
        ? Colors.red
        : priority == 'low'
            ? Colors.grey
            : Colors.blue;

    return ListTile(
      leading: IconButton(
        icon: Icon(
          isComplete ? Icons.check_circle : Icons.circle_outlined,
          color: isComplete
              ? Colors.green
              : isOverdue
                  ? Colors.red
                  : theme.colorScheme.onSurfaceVariant,
        ),
        onPressed: onToggle,
      ),
      title: Text(
        task['title'] ?? 'Untitled',
        style: TextStyle(
          fontWeight: FontWeight.w500,
          decoration: isComplete ? TextDecoration.lineThrough : null,
          color: isComplete
              ? theme.colorScheme.onSurfaceVariant
              : isOverdue
                  ? Colors.red
                  : null,
        ),
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 4),
          // Row 1: priority badge + relative due date
          Row(
            children: [
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                decoration: BoxDecoration(
                  color: priorityColor.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(priority,
                    style:
                        TextStyle(fontSize: 11, color: priorityColor)),
              ),
              if (relativeDue != null) ...[
                const SizedBox(width: 8),
                Icon(
                  isOverdue
                      ? Icons.warning_amber_rounded
                      : Icons.calendar_today,
                  size: 12,
                  color: isOverdue
                      ? Colors.red
                      : theme.colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    relativeDue!,
                    style: isOverdue
                        ? theme.textTheme.bodySmall?.copyWith(
                            color: Colors.red,
                            fontWeight: FontWeight.bold,
                          )
                        : theme.textTheme.bodySmall,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ],
          ),
          // Row 2: assignee + linked entity
          if (assigneeName != null || linkedEntityWidget != null) ...[
            const SizedBox(height: 4),
            Row(
              children: [
                if (assigneeName != null) ...[
                  Icon(Icons.person_outline,
                      size: 12,
                      color: theme.colorScheme.onSurfaceVariant),
                  const SizedBox(width: 3),
                  Flexible(
                    child: Text(
                      assigneeName!,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
                if (assigneeName != null && linkedEntityWidget != null)
                  const SizedBox(width: 12),
                if (linkedEntityWidget != null)
                  Flexible(child: linkedEntityWidget!),
              ],
            ),
          ],
        ],
      ),
      onTap: onTap,
    );
  }
}
