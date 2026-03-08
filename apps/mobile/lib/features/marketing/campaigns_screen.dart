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

class _CampaignsScreenState extends ConsumerState<CampaignsScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  // Campaigns tab state
  List<Map<String, dynamic>> _campaigns = [];
  bool _loading = true;
  String? _error;
  String _statusFilter = 'all';
  String _search = '';

  // Dashboard tab state
  Map<String, dynamic>? _dashboardData;
  bool _dashLoading = false;
  String? _dashError;
  String _dashPeriod = 'all';

  static const _statusFilters = ['all', 'draft', 'active', 'paused', 'completed'];

  static const _statusColors = {
    'draft': Colors.grey,
    'active': Colors.green,
    'paused': Colors.orange,
    'completed': Colors.blue,
    'cancelled': Colors.red,
  };

  static const _periodOptions = [
    {'value': 'all', 'label': 'All'},
    {'value': '7d', 'label': '7d'},
    {'value': '30d', 'label': '30d'},
    {'value': '90d', 'label': '90d'},
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(() {
      if (_tabController.index == 1 && _dashboardData == null && !_dashLoading) {
        _loadDashboard();
      }
    });
    _loadCampaigns();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
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

  Future<void> _loadDashboard() async {
    setState(() { _dashLoading = true; _dashError = null; });
    try {
      final queryParams = <String, String>{};
      if (_dashPeriod != 'all') {
        queryParams['period'] = _dashPeriod;
      }
      final res = await ApiClient.instance.dio.get(
        '${Endpoints.apiUrl}/api/v1/campaigns/dashboard',
        queryParameters: queryParams,
      );
      final data = res.data['data'] ?? res.data;
      if (mounted) setState(() => _dashboardData = data);
    } catch (e) {
      if (mounted) setState(() => _dashError = 'Failed to load dashboard');
    } finally {
      if (mounted) setState(() => _dashLoading = false);
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

  // ── Dashboard helpers ───────────────────────────────────────────────

  Map<String, int> get _statusCounts {
    final counts = <String, int>{};
    for (final c in _campaigns) {
      final s = (c['status'] ?? 'draft').toString();
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }

  Map<String, int> get _typeCounts {
    final counts = <String, int>{};
    for (final c in _campaigns) {
      final t = (c['type'] ?? 'other').toString();
      counts[t] = (counts[t] ?? 0) + 1;
    }
    return counts;
  }

  Map<String, Map<String, num>> get _channelPerformance {
    final channels = <String, Map<String, num>>{};
    for (final c in _campaigns) {
      final ch = (c['channel'] ?? c['type'] ?? 'other').toString();
      final entry = channels.putIfAbsent(ch, () => {'count': 0, 'revenue': 0});
      entry['count'] = (entry['count'] ?? 0) + 1;
      entry['revenue'] = (entry['revenue'] ?? 0) + (num.tryParse('${c['revenue'] ?? 0}') ?? 0);
    }
    return channels;
  }

  List<Map<String, dynamic>> get _topCampaigns {
    final sorted = List<Map<String, dynamic>>.from(_campaigns);
    sorted.sort((a, b) {
      final aEng = (num.tryParse('${a['opened_count'] ?? a['openedCount'] ?? 0}') ?? 0);
      final bEng = (num.tryParse('${b['opened_count'] ?? b['openedCount'] ?? 0}') ?? 0);
      return bEng.compareTo(aEng);
    });
    return sorted.take(5).toList();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Marketing'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              _loadCampaigns();
              if (_tabController.index == 1) _loadDashboard();
            },
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(icon: Icon(Icons.campaign_outlined, size: 18), text: 'Campaigns'),
            Tab(icon: Icon(Icons.dashboard_outlined, size: 18), text: 'Dashboard'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildCampaignsTab(theme),
          _buildDashboardTab(theme),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Campaign creation coming soon')),
          );
        },
        child: const Icon(Icons.add),
      ),
    );
  }

  // ── Campaigns Tab ───────────────────────────────────────────────────

  Widget _buildCampaignsTab(ThemeData theme) {
    if (_loading) return const LoadingIndicator();
    if (_error != null) return ErrorView(message: _error!, onRetry: _loadCampaigns);

    return Column(
      children: [
        // Search bar
        Padding(
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
                  title: 'No campaigns found',
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
    );
  }

  // ── Dashboard Tab ───────────────────────────────────────────────────

  Widget _buildDashboardTab(ThemeData theme) {
    // Use API dashboard data if available, otherwise derive from campaigns list
    final summary = _dashboardData?['summary'] as Map<String, dynamic>?;
    final byChannel = _dashboardData?['byChannel'] as List? ?? [];
    final topFromApi = _dashboardData?['topCampaigns'] as List? ?? [];

    if (_dashLoading && _dashboardData == null && _loading) {
      return const LoadingIndicator();
    }
    if (_dashError != null && _dashboardData == null && _campaigns.isEmpty) {
      return ErrorView(message: _dashError!, onRetry: _loadDashboard);
    }

    return RefreshIndicator(
      onRefresh: () async {
        await _loadCampaigns();
        await _loadDashboard();
      },
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Period selector
          Row(
            children: [
              Text('PERIOD', style: theme.textTheme.labelSmall?.copyWith(
                fontWeight: FontWeight.w600, letterSpacing: 1,
                color: theme.colorScheme.onSurfaceVariant,
              )),
              const Spacer(),
              ..._periodOptions.map((opt) {
                final selected = _dashPeriod == opt['value'];
                return Padding(
                  padding: const EdgeInsets.only(left: 4),
                  child: ChoiceChip(
                    label: Text(opt['label']!, style: const TextStyle(fontSize: 11)),
                    selected: selected,
                    onSelected: (_) {
                      setState(() => _dashPeriod = opt['value']!);
                      _loadDashboard();
                    },
                    visualDensity: VisualDensity.compact,
                  ),
                );
              }),
            ],
          ),
          const SizedBox(height: 16),

          // Campaign count by status
          Text('CAMPAIGNS BY STATUS', style: theme.textTheme.labelSmall?.copyWith(
            fontWeight: FontWeight.w600, letterSpacing: 1,
            color: theme.colorScheme.onSurfaceVariant,
          )),
          const SizedBox(height: 8),
          _buildStatusCountsSection(theme, summary),
          const SizedBox(height: 20),

          // Performance metrics
          Text('PERFORMANCE METRICS', style: theme.textTheme.labelSmall?.copyWith(
            fontWeight: FontWeight.w600, letterSpacing: 1,
            color: theme.colorScheme.onSurfaceVariant,
          )),
          const SizedBox(height: 8),
          _buildPerformanceMetrics(theme, summary),
          const SizedBox(height: 20),

          // Campaign type breakdown
          Text('CAMPAIGN TYPES', style: theme.textTheme.labelSmall?.copyWith(
            fontWeight: FontWeight.w600, letterSpacing: 1,
            color: theme.colorScheme.onSurfaceVariant,
          )),
          const SizedBox(height: 8),
          _buildTypeBreakdown(theme),
          const SizedBox(height: 20),

          // Channel performance
          Text('CHANNEL PERFORMANCE', style: theme.textTheme.labelSmall?.copyWith(
            fontWeight: FontWeight.w600, letterSpacing: 1,
            color: theme.colorScheme.onSurfaceVariant,
          )),
          const SizedBox(height: 8),
          _buildChannelPerformance(theme, byChannel),
          const SizedBox(height: 20),

          // Top performing campaigns
          Text('TOP CAMPAIGNS', style: theme.textTheme.labelSmall?.copyWith(
            fontWeight: FontWeight.w600, letterSpacing: 1,
            color: theme.colorScheme.onSurfaceVariant,
          )),
          const SizedBox(height: 8),
          _buildTopCampaigns(theme, topFromApi),
          const SizedBox(height: 80), // Space for FAB
        ],
      ),
    );
  }

  Widget _buildStatusCountsSection(ThemeData theme, Map<String, dynamic>? summary) {
    final counts = _statusCounts;
    final totalFromApi = summary?['total_campaigns'];
    final activeFromApi = summary?['active_campaigns'];

    final items = <_MetricItem>[
      _MetricItem(
        label: 'Total',
        value: '${totalFromApi ?? _campaigns.length}',
        icon: Icons.campaign,
        color: Colors.blue,
      ),
      _MetricItem(
        label: 'Active',
        value: '${activeFromApi ?? counts['active'] ?? 0}',
        icon: Icons.play_circle_outline,
        color: Colors.green,
      ),
      _MetricItem(
        label: 'Draft',
        value: '${counts['draft'] ?? 0}',
        icon: Icons.edit_outlined,
        color: Colors.grey,
      ),
      _MetricItem(
        label: 'Completed',
        value: '${counts['completed'] ?? 0}',
        icon: Icons.check_circle_outline,
        color: Colors.blue,
      ),
    ];

    return _buildMetricGrid(theme, items);
  }

  Widget _buildPerformanceMetrics(ThemeData theme, Map<String, dynamic>? summary) {
    final totalSent = summary?['total_sent'] ?? 0;
    final totalOpened = summary?['total_opened'] ?? 0;
    final totalClicked = summary?['total_clicked'] ?? 0;
    final totalConverted = summary?['total_converted'] ?? 0;
    final totalRevenue = summary?['total_revenue'] ?? 0;
    final totalBudget = summary?['total_budget'] ?? 0;

    String pct(num a, num b) => b > 0 ? '${((a / b) * 100).toStringAsFixed(1)}%' : '0%';
    String fmtNum(num n) => n >= 1000 ? '${(n / 1000).toStringAsFixed(1)}k' : '$n';
    String fmtCurrency(num n) => '\$${n >= 1000 ? '${(n / 1000).toStringAsFixed(1)}k' : n.toStringAsFixed(0)}';

    // Calculate from campaigns list if API summary not available
    num calcTotalSent = totalSent;
    num calcTotalOpened = totalOpened;
    num calcTotalClicked = totalClicked;
    num calcTotalConverted = totalConverted;
    num calcRevenue = totalRevenue;
    num calcBudget = totalBudget;

    if (summary == null) {
      for (final c in _campaigns) {
        calcTotalSent += (num.tryParse('${c['sent_count'] ?? c['sentCount'] ?? 0}') ?? 0);
        calcTotalOpened += (num.tryParse('${c['opened_count'] ?? c['openedCount'] ?? 0}') ?? 0);
        calcTotalClicked += (num.tryParse('${c['clicked_count'] ?? c['clickedCount'] ?? 0}') ?? 0);
        calcTotalConverted += (num.tryParse('${c['converted_count'] ?? c['convertedCount'] ?? 0}') ?? 0);
        calcRevenue += (num.tryParse('${c['revenue'] ?? 0}') ?? 0);
        calcBudget += (num.tryParse('${c['budget'] ?? 0}') ?? 0);
      }
    }

    final items = <_MetricItem>[
      _MetricItem(
        label: 'Total Reach',
        value: fmtNum(summary != null ? totalSent : calcTotalSent),
        icon: Icons.people_outline,
        color: Colors.indigo,
      ),
      _MetricItem(
        label: 'Engagement',
        value: pct(summary != null ? totalOpened : calcTotalOpened,
            summary != null ? totalSent : calcTotalSent),
        icon: Icons.visibility_outlined,
        color: Colors.teal,
      ),
      _MetricItem(
        label: 'Conversion',
        value: pct(summary != null ? totalConverted : calcTotalConverted,
            summary != null ? totalSent : calcTotalSent),
        icon: Icons.trending_up,
        color: Colors.green,
      ),
      _MetricItem(
        label: 'ROI',
        value: (summary != null ? calcBudget : calcBudget) > 0
            ? '${(((summary != null ? calcRevenue : calcRevenue) / (summary != null ? calcBudget : calcBudget)) * 100).toStringAsFixed(0)}%'
            : 'N/A',
        icon: Icons.attach_money,
        color: Colors.amber.shade700,
      ),
    ];

    return _buildMetricGrid(theme, items);
  }

  Widget _buildMetricGrid(ThemeData theme, List<_MetricItem> items) {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisSpacing: 8,
      mainAxisSpacing: 8,
      childAspectRatio: 2.2,
      children: items.map((item) => Card(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Row(
                children: [
                  Icon(item.icon, size: 16, color: item.color),
                  const SizedBox(width: 6),
                  Text(item.label, style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  )),
                ],
              ),
              const SizedBox(height: 4),
              Text(item.value, style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.bold,
              )),
            ],
          ),
        ),
      )).toList(),
    );
  }

  Widget _buildTypeBreakdown(ThemeData theme) {
    final types = _typeCounts;
    if (types.isEmpty) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Center(child: Text('No campaign data',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant))),
        ),
      );
    }

    final total = types.values.fold<int>(0, (a, b) => a + b);
    final typeColors = [
      Colors.blue, Colors.green, Colors.orange, Colors.purple,
      Colors.teal, Colors.red, Colors.indigo, Colors.pink,
    ];

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            // Simple bar representation
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: SizedBox(
                height: 24,
                child: Row(
                  children: types.entries.toList().asMap().entries.map((entry) {
                    final idx = entry.key;
                    final e = entry.value;
                    final pct = total > 0 ? e.value / total : 0.0;
                    return Expanded(
                      flex: (pct * 100).round().clamp(1, 100),
                      child: Container(
                        color: typeColors[idx % typeColors.length],
                      ),
                    );
                  }).toList(),
                ),
              ),
            ),
            const SizedBox(height: 12),
            // Legend
            Wrap(
              spacing: 12,
              runSpacing: 6,
              children: types.entries.toList().asMap().entries.map((entry) {
                final idx = entry.key;
                final e = entry.value;
                return Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 10, height: 10,
                      decoration: BoxDecoration(
                        color: typeColors[idx % typeColors.length],
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                    const SizedBox(width: 4),
                    Text('${e.key} (${e.value})', style: const TextStyle(fontSize: 12)),
                  ],
                );
              }).toList(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildChannelPerformance(ThemeData theme, List<dynamic> byChannelApi) {
    // Prefer API data, fall back to derived data
    final channels = <String, Map<String, num>>{};
    if (byChannelApi.isNotEmpty) {
      for (final ch in byChannelApi) {
        final name = (ch['channel'] ?? 'other').toString();
        channels[name] = {
          'count': (num.tryParse('${ch['count'] ?? 0}') ?? 0),
          'revenue': (num.tryParse('${ch['revenue'] ?? 0}') ?? 0),
        };
      }
    } else {
      channels.addAll(_channelPerformance);
    }

    if (channels.isEmpty) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Center(child: Text('No channel data',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant))),
        ),
      );
    }

    final maxRevenue = channels.values.fold<num>(0, (a, b) {
      final r = b['revenue'] ?? 0;
      return r > a ? r : a;
    });

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: channels.entries.map((e) {
            final pctWidth = maxRevenue > 0 ? (e.value['revenue']! / maxRevenue) : 0.0;
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  SizedBox(
                    width: 80,
                    child: Text(
                      e.key.replaceAll('_', ' '),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: pctWidth.toDouble(),
                        minHeight: 16,
                        backgroundColor: theme.colorScheme.surfaceContainerHighest,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(
                    width: 50,
                    child: Text(
                      '${e.value['count']}',
                      style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600),
                      textAlign: TextAlign.right,
                    ),
                  ),
                ],
              ),
            );
          }).toList(),
        ),
      ),
    );
  }

  Widget _buildTopCampaigns(ThemeData theme, List<dynamic> topFromApi) {
    final top = topFromApi.isNotEmpty
        ? topFromApi.take(5).toList()
        : _topCampaigns;

    if (top.isEmpty) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Center(child: Text('No campaigns yet',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant))),
        ),
      );
    }

    return Card(
      child: Column(
        children: top.asMap().entries.map((entry) {
          final idx = entry.key;
          final camp = entry.value;
          final name = camp['name'] ?? 'Untitled';
          final type = camp['type'] ?? '';
          final status = camp['status'] ?? '';
          final engagement = camp['opened'] ?? camp['opened_count'] ?? camp['openedCount'] ?? 0;

          return ListTile(
            leading: CircleAvatar(
              radius: 14,
              backgroundColor: theme.colorScheme.primaryContainer,
              child: Text('${idx + 1}',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold,
                      color: theme.colorScheme.onPrimaryContainer)),
            ),
            title: Text(name, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                maxLines: 1, overflow: TextOverflow.ellipsis),
            subtitle: Text('$type  ·  $status',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
            trailing: Text('$engagement opens',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600,
                    color: Colors.green.shade700)),
            dense: true,
          );
        }).toList(),
      ),
    );
  }
}

class _MetricItem {
  final String label;
  final String value;
  final IconData icon;
  final Color color;

  const _MetricItem({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
  });
}
