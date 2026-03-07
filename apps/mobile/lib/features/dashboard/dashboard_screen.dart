import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../core/auth/auth_provider.dart';

class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  Map<String, dynamic> _stats = {};
  List<Map<String, dynamic>> _recentActivities = [];
  List<Map<String, dynamic>> _upcomingTasks = [];
  Map<String, int> _pipelineByStage = {};
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadDashboard();
  }

  Future<void> _loadDashboard() async {
    setState(() => _loading = true);
    try {
      final dio = ApiClient.instance.dio;
      final results = await Future.wait([
        dio.get(Endpoints.deals, queryParameters: {'limit': '200'}).catchError((_) => null),
        dio.get(Endpoints.activities, queryParameters: {'limit': '5'}).catchError((_) => null),
        dio.get(Endpoints.tasks, queryParameters: {'limit': '5', 'status': 'pending'}).catchError((_) => null),
        dio.get(Endpoints.contacts, queryParameters: {'limit': '1'}).catchError((_) => null),
      ]);

      if (mounted) {
        setState(() {
          // Deals stats + pipeline breakdown
          if (results[0] != null) {
            final data = results[0]!.data['data'];
            final items = data is List ? data : (data is Map ? (data['items'] ?? data['deals'] ?? []) : []);
            final deals = List<Map<String, dynamic>>.from(items);

            int openValue = 0;
            int wonValue = 0;
            int wonCount = 0;
            int lostCount = 0;
            final byStage = <String, int>{};

            for (final d in deals) {
              final stage = d['stage'] ?? 'lead';
              byStage[stage] = (byStage[stage] ?? 0) + 1;
              final val = d['value'] is num ? (d['value'] as num).toInt() : 0;

              if (stage == 'closed_won') { wonValue += val; wonCount++; }
              else if (stage == 'closed_lost') { lostCount++; }
              else { openValue += val; }
            }

            _stats['openPipeline'] = openValue;
            _stats['openDeals'] = deals.length - wonCount - lostCount;
            _stats['revenue30d'] = wonValue;
            _stats['wonDeals'] = wonCount;
            _stats['winRate'] = (wonCount + lostCount) > 0
                ? ((wonCount / (wonCount + lostCount)) * 100).round()
                : 0;
            _pipelineByStage = byStage;
          }

          // Recent activities
          if (results[1] != null) {
            final data = results[1]!.data['data'];
            final items = data is List ? data : (data is Map ? (data['items'] ?? data['activities'] ?? []) : []);
            _recentActivities = List<Map<String, dynamic>>.from(items).take(5).toList();
          }

          // Upcoming tasks
          if (results[2] != null) {
            final data = results[2]!.data['data'];
            final items = data is List ? data : (data is Map ? (data['items'] ?? data['tasks'] ?? []) : []);
            _upcomingTasks = List<Map<String, dynamic>>.from(items).take(5).toList();
          }

          // Contact count
          if (results[3] != null) {
            final data = results[3]!.data['data'];
            if (data is Map && data['total'] != null) {
              _stats['contacts'] = data['total'];
            }
          }
        });
      }
    } catch (_) {}
    finally { if (mounted) setState(() => _loading = false); }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final user = ref.watch(authProvider).user;

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Welcome back${user != null ? ", ${user.firstName}" : ""}',
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
            Text('NexCRM Dashboard',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ],
        ),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadDashboard),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadDashboard,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // KPI Cards
            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
              childAspectRatio: 1.5,
              children: [
                _KpiCard(
                  icon: Icons.handshake_outlined, label: 'Open Pipeline',
                  value: _formatCurrency(_stats['openPipeline'] ?? 0),
                  sub: '${_stats['openDeals'] ?? 0} active deals',
                  color: Colors.blue, loading: _loading,
                  onTap: () => context.go('/pipeline'),
                ),
                _KpiCard(
                  icon: Icons.trending_up, label: 'Revenue (30d)',
                  value: _formatCurrency(_stats['revenue30d'] ?? 0),
                  sub: '${_stats['wonDeals'] ?? 0} closed won',
                  color: Colors.green, loading: _loading,
                  onTap: () => context.push('/reports'),
                ),
                _KpiCard(
                  icon: Icons.emoji_events_outlined, label: 'Win Rate',
                  value: '${_stats['winRate'] ?? 0}%',
                  sub: '${_stats['wonDeals'] ?? 0} won',
                  color: Colors.purple, loading: _loading,
                ),
                _KpiCard(
                  icon: Icons.people_outlined, label: 'Active Contacts',
                  value: '${_stats['contacts'] ?? '-'}',
                  sub: '', color: Colors.orange, loading: _loading,
                  onTap: () => context.go('/contacts'),
                ),
              ],
            ),
            const SizedBox(height: 20),

            // Pipeline by Stage
            if (_pipelineByStage.isNotEmpty) ...[
              _SectionHeader(title: 'Pipeline by Stage', onSeeAll: () => context.go('/pipeline')),
              const SizedBox(height: 8),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(children: _buildPipelineBars(theme)),
                ),
              ),
              const SizedBox(height: 20),
            ],

            // Recent Activity
            _SectionHeader(title: 'Recent Activity', onSeeAll: () => context.push('/activities')),
            const SizedBox(height: 8),
            if (_recentActivities.isEmpty && !_loading)
              Card(child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text('No recent activities', style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              ))
            else
              ...(_recentActivities.map((a) => _ActivityTile(activity: a))),
            const SizedBox(height: 20),

            // Upcoming Tasks
            _SectionHeader(title: 'Upcoming Tasks', onSeeAll: () => context.push('/tasks')),
            const SizedBox(height: 8),
            if (_upcomingTasks.isEmpty && !_loading)
              Card(child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text('No pending tasks', style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              ))
            else
              ...(_upcomingTasks.map((t) => _TaskTile(task: t))),
            const SizedBox(height: 20),

            // Quick Actions
            Text('Quick Actions', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8, runSpacing: 8,
              children: [
                ActionChip(avatar: const Icon(Icons.person_add, size: 18),
                    label: const Text('New Contact'), onPressed: () => context.push('/contacts/new')),
                ActionChip(avatar: const Icon(Icons.handshake, size: 18),
                    label: const Text('New Deal'), onPressed: () => context.push('/deals/new')),
                ActionChip(avatar: const Icon(Icons.task_alt, size: 18),
                    label: const Text('New Task'), onPressed: () => context.push('/tasks')),
                ActionChip(avatar: const Icon(Icons.business, size: 18),
                    label: const Text('New Company'), onPressed: () => context.push('/companies/new')),
              ],
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  List<Widget> _buildPipelineBars(ThemeData theme) {
    const labels = {'lead': 'Lead', 'qualified': 'Qualified', 'discovery': 'Discovery',
      'proposal': 'Proposal', 'negotiation': 'Negotiation', 'closed_won': 'Won', 'closed_lost': 'Lost'};
    const colors = {'lead': Colors.grey, 'qualified': Colors.blue, 'discovery': Colors.indigo,
      'proposal': Colors.orange, 'negotiation': Colors.deepOrange, 'closed_won': Colors.green, 'closed_lost': Colors.red};
    final maxVal = _pipelineByStage.values.fold(0, (a, b) => a > b ? a : b);

    return _pipelineByStage.entries.map((e) {
      final pct = maxVal > 0 ? e.value / maxVal : 0.0;
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [
          SizedBox(width: 80, child: Text(labels[e.key] ?? e.key,
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant, fontSize: 11))),
          Expanded(child: ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(value: pct,
                backgroundColor: theme.colorScheme.surfaceContainerHighest,
                color: colors[e.key] ?? Colors.grey, minHeight: 10),
          )),
          const SizedBox(width: 8),
          SizedBox(width: 24, child: Text('${e.value}', textAlign: TextAlign.right,
              style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600, fontSize: 11))),
        ]),
      );
    }).toList();
  }

  String _formatCurrency(int value) {
    if (value >= 1000000) return '\$${(value / 1000000).toStringAsFixed(1)}M';
    if (value >= 1000) return '\$${(value / 1000).toStringAsFixed(0)}K';
    return '\$$value';
  }
}

class _KpiCard extends StatelessWidget {
  final IconData icon; final String label; final String value; final String sub;
  final Color color; final bool loading; final VoidCallback? onTap;

  const _KpiCard({required this.icon, required this.label, required this.value,
    required this.sub, required this.color, this.loading = false, this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(clipBehavior: Clip.antiAlias, child: InkWell(onTap: onTap, child: Padding(
      padding: const EdgeInsets.all(14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Expanded(child: Text(label, style: theme.textTheme.bodySmall
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant), overflow: TextOverflow.ellipsis)),
          Container(padding: const EdgeInsets.all(6), decoration: BoxDecoration(
              color: color.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
            child: Icon(icon, size: 16, color: color)),
        ]),
        loading
            ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
            : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(value, style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
                if (sub.isNotEmpty) Text(sub, style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant, fontSize: 10)),
              ]),
      ]),
    )));
  }
}

class _SectionHeader extends StatelessWidget {
  final String title; final VoidCallback? onSeeAll;
  const _SectionHeader({required this.title, this.onSeeAll});
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
      Text(title, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
      if (onSeeAll != null) GestureDetector(onTap: onSeeAll,
        child: Text('See all', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.primary))),
    ]);
  }
}

class _ActivityTile extends StatelessWidget {
  final Map<String, dynamic> activity;
  const _ActivityTile({required this.activity});

  IconData _iconFor(String type) {
    switch (type) { case 'email': return Icons.mail_outlined; case 'call': return Icons.phone_outlined;
      case 'meeting': return Icons.event_outlined; case 'note': return Icons.note_outlined; default: return Icons.timeline; }
  }
  Color _colorFor(String type) {
    switch (type) { case 'email': return Colors.blue; case 'call': return Colors.green;
      case 'meeting': return Colors.purple; case 'note': return Colors.orange; default: return Colors.grey; }
  }

  @override
  Widget build(BuildContext context) {
    final type = activity['type'] ?? 'note';
    final color = _colorFor(type);
    return Card(child: ListTile(dense: true,
      leading: Container(padding: const EdgeInsets.all(6), decoration: BoxDecoration(
          color: color.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
        child: Icon(_iconFor(type), size: 18, color: color)),
      title: Text(activity['notes'] ?? activity['subject'] ?? type,
          maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
      subtitle: Text(activity['createdAt'] ?? '', style: const TextStyle(fontSize: 11)),
    ));
  }
}

class _TaskTile extends StatelessWidget {
  final Map<String, dynamic> task;
  const _TaskTile({required this.task});
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final completed = task['status'] == 'completed';
    return Card(child: ListTile(dense: true,
      leading: Icon(completed ? Icons.check_circle : Icons.radio_button_unchecked,
          color: completed ? Colors.green : theme.colorScheme.onSurfaceVariant, size: 20),
      title: Text(task['title'] ?? 'Untitled', maxLines: 1, overflow: TextOverflow.ellipsis,
          style: TextStyle(fontSize: 13, decoration: completed ? TextDecoration.lineThrough : null)),
      subtitle: task['dueDate'] != null || task['due_date'] != null
          ? Text('Due: ${task['dueDate'] ?? task['due_date']}', style: const TextStyle(fontSize: 11)) : null,
    ));
  }
}
