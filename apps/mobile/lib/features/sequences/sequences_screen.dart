import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
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
  String _filter = 'all';

  @override
  void initState() {
    super.initState();
    _loadSequences();
  }

  Future<void> _loadSequences() async {
    setState(() { _loading = true; _error = null; });
    try {
      final params = <String, String>{};
      if (_filter != 'all') params['status'] = _filter;
      final res = await ApiClient.instance.dio.get(Endpoints.sequences, queryParameters: params);
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['sequences'] ?? []) : []);
      if (mounted) setState(() => _sequences = List<Map<String, dynamic>>.from(items));
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load sequences');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'active': return Colors.green;
      case 'paused': return Colors.orange;
      case 'archived': return Colors.red;
      default: return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Sequences'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadSequences),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: SizedBox(
            height: 42,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              children: ['all', 'active', 'draft', 'paused'].map((f) =>
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(f[0].toUpperCase() + f.substring(1)),
                    selected: _filter == f,
                    onSelected: (_) {
                      setState(() => _filter = f);
                      _loadSequences();
                    },
                  ),
                ),
              ).toList(),
            ),
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () async {
          final created = await context.push<bool>('/sequences/new');
          if (created == true) _loadSequences();
        },
        child: const Icon(Icons.add),
      ),
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
                          final color = _statusColor(status);
                          final activeEnrollments = s['active_enrollments'] ?? s['activeEnrollments'] ?? 0;
                          final completedEnrollments = s['completed_enrollments'] ?? s['completedEnrollments'] ?? 0;

                          return Card(
                            child: InkWell(
                              borderRadius: BorderRadius.circular(12),
                              onTap: () async {
                                final refreshed = await Navigator.push<bool>(
                                  context,
                                  MaterialPageRoute(builder: (_) => _SequenceDetailScreen(sequence: s)),
                                );
                                if (refreshed == true) _loadSequences();
                              },
                              child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Container(
                                          padding: const EdgeInsets.all(8),
                                          decoration: BoxDecoration(
                                            color: color.withOpacity(0.1),
                                            borderRadius: BorderRadius.circular(8),
                                          ),
                                          child: Icon(Icons.autorenew, size: 20, color: color),
                                        ),
                                        const SizedBox(width: 12),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(s['name'] ?? 'Untitled',
                                                  style: const TextStyle(fontWeight: FontWeight.w600)),
                                              if (s['goal'] != null && s['goal'].toString().isNotEmpty)
                                                Text(s['goal'], style: theme.textTheme.bodySmall
                                                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                                                    maxLines: 1, overflow: TextOverflow.ellipsis),
                                            ],
                                          ),
                                        ),
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                          decoration: BoxDecoration(
                                            color: color.withOpacity(0.1),
                                            borderRadius: BorderRadius.circular(4),
                                          ),
                                          child: Text(status, style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w600)),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 12),
                                    Row(
                                      children: [
                                        _StatChip(icon: Icons.format_list_numbered, label: '${s['step_count'] ?? s['steps']?.length ?? 0} steps'),
                                        const SizedBox(width: 12),
                                        _StatChip(icon: Icons.people, label: '$activeEnrollments active'),
                                        const SizedBox(width: 12),
                                        _StatChip(icon: Icons.check_circle_outline, label: '$completedEnrollments done'),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}

class _StatChip extends StatelessWidget {
  final IconData icon;
  final String label;
  const _StatChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: Theme.of(context).colorScheme.onSurfaceVariant),
        const SizedBox(width: 4),
        Text(label, style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
      ],
    );
  }
}

// ── Sequence Detail Screen ──

class _SequenceDetailScreen extends ConsumerStatefulWidget {
  final Map<String, dynamic> sequence;
  const _SequenceDetailScreen({required this.sequence});

  @override
  ConsumerState<_SequenceDetailScreen> createState() => _SequenceDetailScreenState();
}

class _SequenceDetailScreenState extends ConsumerState<_SequenceDetailScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  late Map<String, dynamic> _seq;

  List<Map<String, dynamic>> _steps = [];
  List<Map<String, dynamic>> _enrollments = [];
  Map<String, dynamic>? _analytics;
  bool _loadingSteps = true;
  bool _loadingEnrollments = true;
  bool _loadingAnalytics = true;

  @override
  void initState() {
    super.initState();
    _seq = Map<String, dynamic>.from(widget.sequence);
    _tabController = TabController(length: 3, vsync: this);
    _loadAll();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  void _loadAll() {
    _loadSteps();
    _loadEnrollments();
    _loadAnalytics();
  }

  Future<void> _loadSteps() async {
    try {
      final res = await ApiClient.instance.dio.get('${Endpoints.sequences}/${_seq['id']}/steps');
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['steps'] ?? []) : []);
      if (mounted) setState(() => _steps = List<Map<String, dynamic>>.from(items));
    } catch (_) {}
    finally { if (mounted) setState(() => _loadingSteps = false); }
  }

  Future<void> _loadEnrollments() async {
    try {
      final res = await ApiClient.instance.dio.get('${Endpoints.sequences}/${_seq['id']}/enrollments');
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['enrollments'] ?? []) : []);
      if (mounted) setState(() => _enrollments = List<Map<String, dynamic>>.from(items));
    } catch (_) {}
    finally { if (mounted) setState(() => _loadingEnrollments = false); }
  }

  Future<void> _loadAnalytics() async {
    try {
      final res = await ApiClient.instance.dio.get('${Endpoints.sequences}/${_seq['id']}/analytics');
      if (mounted) setState(() => _analytics = res.data['data']);
    } catch (_) {}
    finally { if (mounted) setState(() => _loadingAnalytics = false); }
  }

  Future<void> _changeStatus(String status) async {
    try {
      await ApiClient.instance.dio.patch('${Endpoints.sequences}/${_seq['id']}/status', data: {'status': status});
      if (mounted) {
        setState(() => _seq['status'] = status);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Sequence ${status == 'active' ? 'activated' : status}')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to change status')),
        );
      }
    }
  }

  void _showEnrollDialog() {
    final firstNameCtl = TextEditingController();
    final lastNameCtl = TextEditingController();
    final emailCtl = TextEditingController();
    bool submitting = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Enroll Contact', style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: TextField(controller: firstNameCtl, decoration: const InputDecoration(labelText: 'First name'))),
                  const SizedBox(width: 12),
                  Expanded(child: TextField(controller: lastNameCtl, decoration: const InputDecoration(labelText: 'Last name'))),
                ],
              ),
              const SizedBox(height: 12),
              TextField(controller: emailCtl, decoration: const InputDecoration(labelText: 'Email'),
                  keyboardType: TextInputType.emailAddress),
              const SizedBox(height: 16),
              SizedBox(
                height: 48,
                child: ElevatedButton(
                  onPressed: submitting ? null : () async {
                    if (emailCtl.text.trim().isEmpty) return;
                    setSheetState(() => submitting = true);
                    try {
                      await ApiClient.instance.dio.post('${Endpoints.sequences}/${_seq['id']}/enroll', data: {
                        'contacts': [{'firstName': firstNameCtl.text.trim(), 'lastName': lastNameCtl.text.trim(), 'email': emailCtl.text.trim()}],
                      });
                      if (ctx.mounted) {
                        Navigator.pop(ctx);
                        _loadEnrollments();
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Contact enrolled')));
                      }
                    } catch (_) {
                      if (ctx.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to enroll')));
                      }
                    } finally {
                      if (ctx.mounted) setSheetState(() => submitting = false);
                    }
                  },
                  child: submitting
                      ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Enroll'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Color _enrollStatusColor(String status) {
    switch (status) {
      case 'active': return Colors.green;
      case 'paused': return Colors.orange;
      case 'completed': return Colors.blue;
      case 'replied': return Colors.purple;
      case 'opted_out': case 'bounced': return Colors.red;
      default: return Colors.grey;
    }
  }

  IconData _stepTypeIcon(String type) {
    switch (type) {
      case 'email': return Icons.email_outlined;
      case 'call': return Icons.phone_outlined;
      case 'linkedin_task': return Icons.business_outlined;
      default: return Icons.task_outlined;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final status = _seq['status'] ?? 'draft';

    return Scaffold(
      appBar: AppBar(
        title: Text(_seq['name'] ?? 'Sequence'),
        actions: [
          if (status == 'draft' || status == 'paused')
            TextButton(onPressed: () => _changeStatus('active'), child: const Text('Activate')),
          if (status == 'active')
            TextButton(onPressed: () => _changeStatus('paused'), child: const Text('Pause')),
          PopupMenuButton<String>(
            onSelected: _changeStatus,
            itemBuilder: (_) => [
              if (status != 'active') const PopupMenuItem(value: 'active', child: Text('Activate')),
              if (status == 'active') const PopupMenuItem(value: 'paused', child: Text('Pause')),
              const PopupMenuItem(value: 'archived', child: Text('Archive')),
            ],
          ),
        ],
        bottom: TabBar(controller: _tabController, tabs: const [
          Tab(text: 'Steps'),
          Tab(text: 'Enrollments'),
          Tab(text: 'Analytics'),
        ]),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          // Steps tab
          _loadingSteps
              ? const Center(child: CircularProgressIndicator())
              : _steps.isEmpty
                  ? const EmptyState(icon: Icons.format_list_numbered, title: 'No steps yet')
                  : ListView.separated(
                      padding: const EdgeInsets.all(12),
                      itemCount: _steps.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, index) {
                        final step = _steps[index];
                        final type = step['type'] ?? 'email';
                        return Card(
                          child: ListTile(
                            leading: CircleAvatar(
                              radius: 16,
                              backgroundColor: theme.colorScheme.primaryContainer,
                              child: Text('${step['step_number'] ?? index + 1}',
                                  style: TextStyle(fontSize: 12, color: theme.colorScheme.onPrimaryContainer, fontWeight: FontWeight.bold)),
                            ),
                            title: Row(children: [
                              Icon(_stepTypeIcon(type), size: 16),
                              const SizedBox(width: 6),
                              Text(type.replaceAll('_', ' '), style: const TextStyle(fontWeight: FontWeight.w500)),
                            ]),
                            subtitle: Text(step['subject_template'] ?? step['task_note'] ?? '',
                                maxLines: 1, overflow: TextOverflow.ellipsis),
                            trailing: Text('Day ${step['day_offset'] ?? 0}', style: theme.textTheme.bodySmall),
                          ),
                        );
                      },
                    ),

          // Enrollments tab
          Column(children: [
            Padding(
              padding: const EdgeInsets.all(12),
              child: SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: _showEnrollDialog,
                  icon: const Icon(Icons.person_add, size: 18),
                  label: const Text('Enroll Contact'),
                ),
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: _loadingEnrollments
                  ? const Center(child: CircularProgressIndicator())
                  : _enrollments.isEmpty
                      ? const EmptyState(icon: Icons.people_outline, title: 'No enrollments')
                      : RefreshIndicator(
                          onRefresh: _loadEnrollments,
                          child: ListView.separated(
                            padding: const EdgeInsets.all(12),
                            itemCount: _enrollments.length,
                            separatorBuilder: (_, __) => const SizedBox(height: 4),
                            itemBuilder: (context, index) {
                              final e = _enrollments[index];
                              final name = '${e['contact_first_name'] ?? ''} ${e['contact_last_name'] ?? ''}'.trim();
                              final eStatus = e['status'] ?? 'active';
                              final color = _enrollStatusColor(eStatus);
                              return Card(
                                child: ListTile(
                                  dense: true,
                                  title: Text(name.isNotEmpty ? name : e['contact_email'] ?? '',
                                      style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 14)),
                                  subtitle: Text('Step ${e['current_step'] ?? '?'} \u00b7 ${e['enrolled_at'] ?? ''}'),
                                  trailing: Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(color: color.withOpacity(0.1), borderRadius: BorderRadius.circular(4)),
                                    child: Text(eStatus, style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w600)),
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
            ),
          ]),

          // Analytics tab
          _loadingAnalytics
              ? const Center(child: CircularProgressIndicator())
              : _analytics == null
                  ? const EmptyState(icon: Icons.analytics_outlined, title: 'No analytics data')
                  : ListView(padding: const EdgeInsets.all(16), children: [
                      GridView.count(
                        crossAxisCount: 2, shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        crossAxisSpacing: 12, mainAxisSpacing: 12, childAspectRatio: 2,
                        children: [
                          _MetricCard(label: 'Total Enrolled', value: '${_analytics!['totalEnrolled'] ?? _analytics!['total_enrolled'] ?? 0}', color: Colors.blue),
                          _MetricCard(label: 'Active', value: '${_analytics!['active'] ?? 0}', color: Colors.green),
                          _MetricCard(label: 'Completed', value: '${_analytics!['completed'] ?? 0}', color: Colors.purple),
                          _MetricCard(label: 'Replied', value: '${_analytics!['replied'] ?? 0}', color: Colors.orange),
                        ],
                      ),
                      const SizedBox(height: 20),
                      Text('Email Performance', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                      const SizedBox(height: 12),
                      _PerformanceBar(label: 'Open Rate', value: (_analytics!['openRate'] ?? _analytics!['open_rate'] ?? 0).toDouble(), color: Colors.blue),
                      const SizedBox(height: 8),
                      _PerformanceBar(label: 'Click Rate', value: (_analytics!['clickRate'] ?? _analytics!['click_rate'] ?? 0).toDouble(), color: Colors.green),
                      const SizedBox(height: 8),
                      _PerformanceBar(label: 'Reply Rate', value: (_analytics!['replyRate'] ?? _analytics!['reply_rate'] ?? 0).toDouble(), color: Colors.purple),
                    ]),
        ],
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  final String label; final String value; final Color color;
  const _MetricCard({required this.label, required this.value, required this.color});
  @override
  Widget build(BuildContext context) {
    return Card(child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Text(label, style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
        Text(value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: color)),
      ]),
    ));
  }
}

class _PerformanceBar extends StatelessWidget {
  final String label; final double value; final Color color;
  const _PerformanceBar({required this.label, required this.value, required this.color});
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final pct = (value / 100).clamp(0.0, 1.0);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Text(label, style: theme.textTheme.bodySmall),
        Text('${value.toStringAsFixed(1)}%', style: TextStyle(fontWeight: FontWeight.w600, color: color, fontSize: 13)),
      ]),
      const SizedBox(height: 4),
      ClipRRect(borderRadius: BorderRadius.circular(4),
        child: LinearProgressIndicator(value: pct, backgroundColor: theme.colorScheme.surfaceContainerHighest, color: color, minHeight: 8)),
    ]);
  }
}
