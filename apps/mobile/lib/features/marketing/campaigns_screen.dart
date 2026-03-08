import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/loading_indicator.dart';
import '../../shared/widgets/error_view.dart';
import '../../shared/widgets/empty_state.dart';

class CampaignsScreen extends ConsumerStatefulWidget {
  const CampaignsScreen({super.key});

  @override
  ConsumerState<CampaignsScreen> createState() => _CampaignsScreenState();
}

class _CampaignsScreenState extends ConsumerState<CampaignsScreen> {
  List<Map<String, dynamic>> _campaigns = [];
  bool _loading = true;
  String? _error;
  String _statusFilter = 'all';
  String _search = '';

  static const _statusFilters = ['all', 'draft', 'active', 'paused', 'completed'];

  static const _statusColors = {
    'draft': Colors.grey,
    'active': Colors.green,
    'paused': Colors.orange,
    'completed': Colors.blue,
    'cancelled': Colors.red,
  };

  @override
  void initState() {
    super.initState();
    _loadCampaigns();
  }

  Future<void> _loadCampaigns() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await ApiClient.instance.dio.get(
        '${Endpoints.apiUrl}/api/v1/campaigns',
        queryParameters: {'limit': '100'},
      );
      final data = res.data['data'] ?? res.data['campaigns'] ?? [];
      if (mounted) {
        setState(() => _campaigns = List<Map<String, dynamic>>.from(data));
      }
    } catch (e) {
      if (mounted) setState(() => _error = 'Failed to load campaigns');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> get _filtered {
    return _campaigns.where((c) {
      if (_statusFilter != 'all' && c['status'] != _statusFilter) return false;
      if (_search.isNotEmpty) {
        final q = _search.toLowerCase();
        final name = (c['name'] ?? '').toString().toLowerCase();
        return name.contains(q);
      }
      return true;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Campaigns'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: TextField(
              decoration: InputDecoration(
                hintText: 'Search campaigns...',
                prefixIcon: const Icon(Icons.search, size: 20),
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 8),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide.none,
                ),
                filled: true,
                fillColor: theme.colorScheme.surfaceContainerHighest.withOpacity(0.5),
              ),
              onChanged: (v) => setState(() => _search = v),
            ),
          ),
        ),
      ),
      body: _loading
          ? const LoadingIndicator()
          : _error != null
              ? ErrorView(message: _error!, onRetry: _loadCampaigns)
              : Column(
                  children: [
                    // Status filter chips
                    SizedBox(
                      height: 48,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        itemCount: _statusFilters.length,
                        separatorBuilder: (_, __) => const SizedBox(width: 8),
                        itemBuilder: (_, i) {
                          final s = _statusFilters[i];
                          final selected = _statusFilter == s;
                          return FilterChip(
                            label: Text(s[0].toUpperCase() + s.substring(1)),
                            selected: selected,
                            onSelected: (_) => setState(() => _statusFilter = s),
                          );
                        },
                      ),
                    ),

                    // Campaign list
                    Expanded(
                      child: _filtered.isEmpty
                          ? const EmptyState(
                              icon: Icons.campaign_outlined,
                              message: 'No campaigns found',
                            )
                          : RefreshIndicator(
                              onRefresh: _loadCampaigns,
                              child: ListView.separated(
                                padding: const EdgeInsets.all(16),
                                itemCount: _filtered.length,
                                separatorBuilder: (_, __) => const SizedBox(height: 8),
                                itemBuilder: (_, i) {
                                  final c = _filtered[i];
                                  final status = c['status'] ?? 'draft';
                                  final color = _statusColors[status] ?? Colors.grey;
                                  final sent = c['sentCount'] ?? c['sent_count'] ?? 0;
                                  final opened = c['openedCount'] ?? c['opened_count'] ?? 0;

                                  return Card(
                                    child: ListTile(
                                      title: Text(
                                        c['name'] ?? 'Untitled',
                                        style: const TextStyle(fontWeight: FontWeight.w600),
                                      ),
                                      subtitle: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          const SizedBox(height: 4),
                                          Row(
                                            children: [
                                              Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                                decoration: BoxDecoration(
                                                  color: color.withOpacity(0.1),
                                                  borderRadius: BorderRadius.circular(12),
                                                ),
                                                child: Text(
                                                  status.toString().toUpperCase(),
                                                  style: TextStyle(
                                                    fontSize: 10,
                                                    fontWeight: FontWeight.w600,
                                                    color: color,
                                                  ),
                                                ),
                                              ),
                                              if (c['type'] != null) ...[
                                                const SizedBox(width: 8),
                                                Text(
                                                  c['type'].toString(),
                                                  style: theme.textTheme.bodySmall?.copyWith(
                                                    color: theme.colorScheme.onSurfaceVariant,
                                                  ),
                                                ),
                                              ],
                                            ],
                                          ),
                                          if (sent > 0) ...[
                                            const SizedBox(height: 4),
                                            Text(
                                              'Sent: $sent  |  Opened: $opened',
                                              style: theme.textTheme.bodySmall?.copyWith(
                                                color: theme.colorScheme.onSurfaceVariant,
                                              ),
                                            ),
                                          ],
                                        ],
                                      ),
                                      trailing: const Icon(Icons.chevron_right, size: 20),
                                      onTap: () {
                                        // Navigate to campaign detail (future)
                                      },
                                    ),
                                  );
                                },
                              ),
                            ),
                    ),
                  ],
                ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          // Navigate to campaign creation (future)
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Campaign creation coming soon')),
          );
        },
        child: const Icon(Icons.add),
      ),
    );
  }
}
