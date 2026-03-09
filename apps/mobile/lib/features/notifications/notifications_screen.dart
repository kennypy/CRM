import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

const _notificationIcons = {
  'ai_review': Icons.auto_awesome,
  'ai_insight': Icons.auto_awesome,
  'deal_alert': Icons.warning_amber_rounded,
  'deal_stage': Icons.trending_up,
  'task_due': Icons.check_box_outlined,
  'sequence': Icons.layers_outlined,
  'call_recording': Icons.phone,
  'forecast': Icons.bar_chart,
  'email': Icons.email_outlined,
  'meeting': Icons.calendar_today_outlined,
  'security': Icons.shield_outlined,
};

const _notificationColors = {
  'ai_review': Colors.purple,
  'ai_insight': Colors.purple,
  'deal_alert': Colors.orange,
  'deal_stage': Colors.green,
  'task_due': Colors.blue,
  'sequence': Colors.indigo,
  'call_recording': Colors.teal,
  'forecast': Colors.amber,
  'email': Colors.blue,
  'meeting': Colors.deepPurple,
  'security': Colors.red,
};

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() =>
      _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  List<Map<String, dynamic>> _notifications = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadNotifications();
  }

  Future<void> _loadNotifications() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await ApiClient.instance.dio.get(
        Endpoints.notifications,
        queryParameters: {'limit': '100'},
      );
      final data = res.data['data'];
      final items = data is List
          ? data
          : (data is Map
              ? (data['notifications'] ?? data['items'] ?? [])
              : []);
      if (mounted) {
        setState(
            () => _notifications = List<Map<String, dynamic>>.from(items));
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load notifications');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _markAsRead(String id, int index) async {
    setState(() {
      _notifications[index] = {
        ..._notifications[index],
        'read_at': DateTime.now().toIso8601String(),
      };
    });
    try {
      await ApiClient.instance.dio.patch(
        '${Endpoints.notifications}/$id/read',
      );
    } catch (_) {
      // Optimistic update — ignore network errors
    }
  }

  Future<void> _markAllAsRead() async {
    setState(() {
      _notifications = _notifications.map((n) {
        if (n['read_at'] == null) {
          return {...n, 'read_at': DateTime.now().toIso8601String()};
        }
        return n;
      }).toList();
    });
    try {
      await ApiClient.instance.dio.post(
        '${Endpoints.notifications}/mark-all-read',
      );
    } catch (_) {
      // Optimistic update — ignore network errors
    }
  }

  int get _unreadCount =>
      _notifications.where((n) => n['read_at'] == null).length;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (!_loading && _unreadCount > 0)
            TextButton.icon(
              onPressed: _markAllAsRead,
              icon: const Icon(Icons.done_all, size: 18),
              label: const Text('Read all'),
            ),
        ],
      ),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadNotifications)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : _notifications.isEmpty
                  ? const EmptyState(
                      icon: Icons.notifications_none,
                      title: 'No notifications',
                      subtitle: "You're all caught up!",
                    )
                  : RefreshIndicator(
                      onRefresh: _loadNotifications,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(12),
                        itemCount: _notifications.length,
                        separatorBuilder: (_, __) =>
                            const SizedBox(height: 4),
                        itemBuilder: (context, index) {
                          final n = _notifications[index];
                          return _NotificationTile(
                            notification: n,
                            onTap: () {
                              final id = n['id']?.toString();
                              if (id != null && n['read_at'] == null) {
                                _markAsRead(id, index);
                              }
                            },
                          );
                        },
                      ),
                    ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  final Map<String, dynamic> notification;
  final VoidCallback onTap;

  const _NotificationTile({
    required this.notification,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final type = notification['type'] ?? '';
    final title = notification['title'] ?? 'Notification';
    final body = notification['body'] ?? notification['message'] ?? '';
    final priority = notification['priority'] ?? 'normal';
    final isUnread = notification['read_at'] == null;
    final createdAt = notification['created_at']?.toString();

    final icon = _notificationIcons[type] ?? Icons.notifications_outlined;
    final color = _notificationColors[type] ?? Colors.grey;

    final Color priorityColor;
    switch (priority) {
      case 'high':
        priorityColor = Colors.red;
        break;
      case 'low':
        priorityColor = Colors.grey;
        break;
      default:
        priorityColor = color;
    }

    return Card(
      elevation: isUnread ? 1 : 0,
      color: isUnread
          ? theme.colorScheme.primaryContainer.withOpacity(0.08)
          : null,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Icon
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, size: 20, color: color),
              ),
              const SizedBox(width: 12),

              // Content
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            title,
                            style: TextStyle(
                              fontWeight:
                                  isUnread ? FontWeight.w600 : FontWeight.w400,
                              fontSize: 14,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (priority == 'high')
                          Container(
                            margin: const EdgeInsets.only(left: 6),
                            padding: const EdgeInsets.symmetric(
                                horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: Colors.red.withOpacity(0.1),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: const Text(
                              'Priority',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w500,
                                color: Colors.red,
                              ),
                            ),
                          ),
                      ],
                    ),
                    if (body.toString().isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        body.toString(),
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: priority == 'low'
                              ? Colors.grey
                              : theme.colorScheme.onSurfaceVariant,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Text(
                          _formatTypeLabel(type),
                          style: TextStyle(
                            fontSize: 11,
                            color: color,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        if (createdAt != null) ...[
                          Text(
                            ' \u00b7 ',
                            style: TextStyle(
                              fontSize: 11,
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                          Text(
                            _formatDate(createdAt),
                            style: TextStyle(
                              fontSize: 11,
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),

              // Unread indicator
              if (isUnread) ...[
                const SizedBox(width: 8),
                Container(
                  margin: const EdgeInsets.only(top: 6),
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primary,
                    shape: BoxShape.circle,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  String _formatTypeLabel(String type) {
    return type
        .replaceAll('_', ' ')
        .split(' ')
        .map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}')
        .join(' ');
  }

  String _formatDate(String? iso) {
    if (iso == null) return '';
    try {
      final d = DateTime.parse(iso);
      final now = DateTime.now();
      final diff = now.difference(d);
      if (diff.inMinutes < 1) return 'just now';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      if (diff.inHours < 24) return '${diff.inHours}h ago';
      if (diff.inDays < 7) return '${diff.inDays}d ago';
      return '${d.month}/${d.day}/${d.year}';
    } catch (_) {
      return '';
    }
  }
}
