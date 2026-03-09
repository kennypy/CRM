import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
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

const _sentimentColors = {
  'positive': Colors.green,
  'neutral': Colors.grey,
  'negative': Colors.red,
};

const _sourceIcons = {
  'gmail': Icons.mail,
  'outlook': Icons.mail_outline,
  'zoom': Icons.videocam,
  'slack': Icons.chat_bubble_outline,
  'manual': Icons.edit,
  'hubspot': Icons.hub,
  'salesforce': Icons.cloud,
};

const _filterTypes = ['all', 'call', 'email', 'meeting', 'note', 'task'];

const _filterLabels = {
  'all': 'All',
  'call': 'Calls',
  'email': 'Emails',
  'meeting': 'Meetings',
  'note': 'Notes',
  'task': 'Tasks',
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
  String _selectedFilter = 'all';

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

  List<Map<String, dynamic>> get _filteredActivities {
    if (_selectedFilter == 'all') return _activities;
    return _activities.where((a) => a['type'] == _selectedFilter).toList();
  }

  Future<void> _navigateToForm() async {
    final result = await context.push<bool>('/activities/new');
    if (result == true) {
      _loadActivities();
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final filtered = _filteredActivities;

    return Scaffold(
      appBar: AppBar(title: const Text('Activities')),
      floatingActionButton: FloatingActionButton(
        onPressed: _navigateToForm,
        child: const Icon(Icons.add),
      ),
      body: Column(
        children: [
          // Filter chips
          SizedBox(
            height: 52,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              itemCount: _filterTypes.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final filter = _filterTypes[index];
                final selected = _selectedFilter == filter;
                return FilterChip(
                  label: Text(_filterLabels[filter] ?? filter),
                  selected: selected,
                  avatar: filter != 'all'
                      ? Icon(
                          _activityIcons[filter],
                          size: 16,
                          color: selected
                              ? theme.colorScheme.onSecondaryContainer
                              : theme.colorScheme.onSurface,
                        )
                      : null,
                  onSelected: (_) => setState(() => _selectedFilter = filter),
                );
              },
            ),
          ),

          // Content
          Expanded(
            child: _error != null
                ? ErrorView(message: _error!, onRetry: _loadActivities)
                : _loading
                    ? const Center(child: CircularProgressIndicator())
                    : filtered.isEmpty
                        ? const EmptyState(icon: Icons.timeline, title: 'No activities yet')
                        : RefreshIndicator(
                            onRefresh: _loadActivities,
                            child: ListView.separated(
                              padding: const EdgeInsets.all(12),
                              itemCount: filtered.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (context, index) {
                                final a = filtered[index];
                                return _ActivityCard(activity: a);
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}

class _ActivityCard extends StatelessWidget {
  final Map<String, dynamic> activity;

  const _ActivityCard({required this.activity});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final type = activity['type'] ?? 'note';
    final icon = _activityIcons[type] ?? Icons.circle;
    final color = _activityColors[type] ?? Colors.grey;
    final sentiment = activity['sentiment'] as String?;
    final source = activity['source'] as String?;
    final duration = activity['duration'];
    final showDuration = (type == 'call' || type == 'meeting') && duration != null;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Type icon
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
                  // Title row
                  Text(
                    activity['subject'] ?? activity['summary'] ?? type,
                    style: const TextStyle(fontWeight: FontWeight.w500),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),

                  // Subtitle info
                  Text(
                    [
                      type,
                      if (activity['direction'] != null) activity['direction'],
                      if (activity['occurred_at'] != null || activity['created_at'] != null)
                        _formatDate(activity['occurred_at'] ?? activity['created_at']),
                    ].join(' \u00b7 '),
                    style: theme.textTheme.bodySmall,
                    maxLines: 1,
                  ),
                  const SizedBox(height: 6),

                  // Badges row
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: [
                      // Sentiment badge
                      if (sentiment != null && _sentimentColors.containsKey(sentiment))
                        _Badge(
                          label: sentiment,
                          color: _sentimentColors[sentiment]!,
                        ),

                      // Source label
                      if (source != null && source.isNotEmpty)
                        _Badge(
                          label: source,
                          color: Colors.blueGrey,
                          icon: _sourceIcons[source.toLowerCase()],
                        ),

                      // Duration
                      if (showDuration)
                        _Badge(
                          label: '${duration}m',
                          color: Colors.indigo,
                          icon: Icons.timer_outlined,
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
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

class _Badge extends StatelessWidget {
  final String label;
  final Color color;
  final IconData? icon;

  const _Badge({required this.label, required this.color, this.icon});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 12, color: color),
            const SizedBox(width: 3),
          ],
          Text(
            label,
            style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w500),
          ),
        ],
      ),
    );
  }
}
