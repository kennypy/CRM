import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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
        dio.get(Endpoints.deals, queryParameters: {'limit': '1'}).catchError((_) => null),
        dio.get(Endpoints.activities, queryParameters: {'limit': '1'}).catchError((_) => null),
        dio.get(Endpoints.tasks, queryParameters: {'limit': '1'}).catchError((_) => null),
        dio.get(Endpoints.contacts, queryParameters: {'limit': '1'}).catchError((_) => null),
      ]);

      if (mounted) {
        setState(() {
          // Extract counts from responses where available
          for (var i = 0; i < results.length; i++) {
            if (results[i] != null) {
              final data = results[i]!.data;
              if (data is Map && data['data'] is Map && data['data']['total'] != null) {
                final keys = ['deals', 'activities', 'tasks', 'contacts'];
                _stats[keys[i]] = data['data']['total'];
              }
            }
          }
        });
      }
    } catch (_) {
      // Dashboard is best-effort
    } finally {
      if (mounted) setState(() => _loading = false);
    }
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
          IconButton(
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () {},
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadDashboard,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Stats grid
            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
              childAspectRatio: 1.6,
              children: [
                _StatCard(
                  icon: Icons.handshake_outlined,
                  label: 'Deals',
                  value: _stats['deals']?.toString() ?? '-',
                  color: Colors.blue,
                  loading: _loading,
                ),
                _StatCard(
                  icon: Icons.people_outlined,
                  label: 'Contacts',
                  value: _stats['contacts']?.toString() ?? '-',
                  color: Colors.green,
                  loading: _loading,
                ),
                _StatCard(
                  icon: Icons.timeline,
                  label: 'Activities',
                  value: _stats['activities']?.toString() ?? '-',
                  color: Colors.orange,
                  loading: _loading,
                ),
                _StatCard(
                  icon: Icons.task_alt,
                  label: 'Tasks',
                  value: _stats['tasks']?.toString() ?? '-',
                  color: Colors.purple,
                  loading: _loading,
                ),
              ],
            ),
            const SizedBox(height: 24),

            // Quick actions
            Text('Quick Actions',
                style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ActionChip(
                  avatar: const Icon(Icons.add, size: 18),
                  label: const Text('New Contact'),
                  onPressed: () {},
                ),
                ActionChip(
                  avatar: const Icon(Icons.add, size: 18),
                  label: const Text('New Deal'),
                  onPressed: () {},
                ),
                ActionChip(
                  avatar: const Icon(Icons.add, size: 18),
                  label: const Text('Log Activity'),
                  onPressed: () {},
                ),
                ActionChip(
                  avatar: const Icon(Icons.add, size: 18),
                  label: const Text('New Task'),
                  onPressed: () {},
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color color;
  final bool loading;

  const _StatCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
    this.loading = false,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(label, style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant)),
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(icon, size: 18, color: color),
                ),
              ],
            ),
            loading
                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : Text(value, style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold)),
          ],
        ),
      ),
    );
  }
}
