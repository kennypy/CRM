import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
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
  List<Map<String, dynamic>> _staleDeals = [];
  Map<String, dynamic> _forecastSummary = {};
  List<Map<String, dynamic>> _teamPerformance = [];
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
      final user = ref.read(authProvider).user;
      final isManager = user?.isManager ?? false;

      final futures = <Future>[
        dio.get(Endpoints.deals, queryParameters: {'limit': '200'}).catchError((_) => null),
        dio.get(Endpoints.activities, queryParameters: {'limit': '5'}).catchError((_) => null),
        dio.get(Endpoints.tasks, queryParameters: {'limit': '5', 'status': 'pending'}).catchError((_) => null),
        dio.get(Endpoints.contacts, queryParameters: {'limit': '1'}).catchError((_) => null),
        // Stale deals: sorted by last activity ascending
        dio.get(Endpoints.deals, queryParameters: {
          'sort': 'lastActivityAt',
          'order': 'asc',
          'limit': '5',
        }).catchError((_) => null),
        // AI forecast summary
        dio.get(Endpoints.aiForecast).catchError((_) => null),
      ];

      // Team performance for managers
      if (isManager) {
        futures.add(
          dio.get(Endpoints.reportsRun, queryParameters: {
            'type': 'team_performance',
            'limit': '10',
          }).catchError((_) => null),
        );
      }

      final results = await Future.wait(futures);

      if (mounted) {
        setState(() {
          // ---------- Deals stats + pipeline breakdown ----------
          List<Map<String, dynamic>> allDeals = [];
          if (results[0] != null) {
            final data = results[0]!.data['data'];
            final items = data is List
                ? data
                : (data is Map ? (data['items'] ?? data['deals'] ?? []) : []);
            allDeals = List<Map<String, dynamic>>.from(items);

            int openValue = 0;
            int wonValue = 0;
            int wonCount = 0;
            int lostCount = 0;
            final byStage = <String, int>{};

            for (final d in allDeals) {
              final stage = d['stage'] ?? 'lead';
              byStage[stage] = (byStage[stage] ?? 0) + 1;
              final val = d['value'] is num ? (d['value'] as num).toInt() : 0;

              if (stage == 'closed_won') {
                wonValue += val;
                wonCount++;
              } else if (stage == 'closed_lost') {
                lostCount++;
              } else {
                openValue += val;
              }
            }

            _stats['openPipeline'] = openValue;
            _stats['openDeals'] = allDeals.length - wonCount - lostCount;
            _stats['revenue30d'] = wonValue;
            _stats['wonDeals'] = wonCount;
            _stats['winRate'] = (wonCount + lostCount) > 0
                ? ((wonCount / (wonCount + lostCount)) * 100).round()
                : 0;
            _pipelineByStage = byStage;
          }

          // ---------- Recent activities ----------
          if (results[1] != null) {
            final data = results[1]!.data['data'];
            final items = data is List
                ? data
                : (data is Map ? (data['items'] ?? data['activities'] ?? []) : []);
            _recentActivities =
                List<Map<String, dynamic>>.from(items).take(5).toList();
          }

          // ---------- Upcoming tasks ----------
          if (results[2] != null) {
            final data = results[2]!.data['data'];
            final items = data is List
                ? data
                : (data is Map ? (data['items'] ?? data['tasks'] ?? []) : []);
            _upcomingTasks =
                List<Map<String, dynamic>>.from(items).take(5).toList();
          }

          // ---------- Contact count ----------
          if (results[3] != null) {
            final data = results[3]!.data['data'];
            if (data is Map && data['total'] != null) {
              _stats['contacts'] = data['total'];
            }
          }

          // ---------- Stale deals ----------
          if (results[4] != null) {
            final data = results[4]!.data['data'];
            final items = data is List
                ? data
                : (data is Map ? (data['items'] ?? data['deals'] ?? []) : []);
            _staleDeals = List<Map<String, dynamic>>.from(items)
                .where((d) =>
                    d['stage'] != 'closed_won' && d['stage'] != 'closed_lost')
                .take(5)
                .toList();
          } else {
            // Fallback: derive stale deals from the full deals list
            _staleDeals = _deriveStaleDeals(allDeals);
          }

          // ---------- Forecast summary ----------
          if (results[5] != null) {
            final data = results[5]!.data['data'] ?? results[5]!.data;
            if (data is Map) {
              _forecastSummary = Map<String, dynamic>.from(data);
            }
          }
          // Fallback: compute forecast buckets from deals data
          if (_forecastSummary.isEmpty && allDeals.isNotEmpty) {
            _forecastSummary = _deriveForecastFromDeals(allDeals);
          }

          // ---------- Team performance ----------
          if (isManager && results.length > 6 && results[6] != null) {
            final data = results[6]!.data['data'];
            final items = data is List
                ? data
                : (data is Map
                    ? (data['items'] ?? data['rows'] ?? data['results'] ?? [])
                    : []);
            _teamPerformance =
                List<Map<String, dynamic>>.from(items).take(10).toList();
          } else if (isManager && allDeals.isNotEmpty) {
            // Fallback: derive team performance from deals
            _teamPerformance = _deriveTeamPerformance(allDeals);
          }
        });
      }
    } catch (_) {}
    finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> _deriveStaleDeals(
      List<Map<String, dynamic>> deals) {
    final now = DateTime.now();
    final openDeals = deals
        .where(
            (d) => d['stage'] != 'closed_won' && d['stage'] != 'closed_lost')
        .toList();

    for (final d in openDeals) {
      final lastActivity = d['lastActivityAt'] ??
          d['last_activity_at'] ??
          d['updatedAt'] ??
          d['updated_at'];
      if (lastActivity != null) {
        try {
          final dt = DateTime.parse(lastActivity.toString());
          d['_daysSinceActivity'] = now.difference(dt).inDays;
        } catch (_) {
          d['_daysSinceActivity'] = 999;
        }
      } else {
        d['_daysSinceActivity'] = 999;
      }
    }

    openDeals.sort((a, b) => (b['_daysSinceActivity'] as int)
        .compareTo(a['_daysSinceActivity'] as int));
    return openDeals.where((d) => (d['_daysSinceActivity'] as int) > 7).take(5).toList();
  }

  Map<String, dynamic> _deriveForecastFromDeals(
      List<Map<String, dynamic>> deals) {
    double likely = 0;
    double possible = 0;
    double atRisk = 0;

    for (final d in deals) {
      if (d['stage'] == 'closed_won' || d['stage'] == 'closed_lost') continue;
      final value =
          d['value'] is num ? (d['value'] as num).toDouble() : 0.0;
      final prob = _getNum(d['declaredProbability'] ??
          d['declared_probability'] ??
          d['realityScore'] ??
          d['reality_score'] ??
          50);

      if (prob > 70) {
        likely += value;
      } else if (prob >= 30) {
        possible += value;
      } else {
        atRisk += value;
      }
    }

    return {
      'likely': likely,
      'possible': possible,
      'atRisk': atRisk,
    };
  }

  List<Map<String, dynamic>> _deriveTeamPerformance(
      List<Map<String, dynamic>> deals) {
    final byOwner = <String, Map<String, dynamic>>{};

    for (final d in deals) {
      final ownerName = d['ownerName'] ??
          d['owner_name'] ??
          (d['owner'] is Map ? d['owner']['fullName'] ?? d['owner']['name'] : null) ??
          'Unknown';
      final ownerId = d['ownerId'] ?? d['owner_id'] ?? ownerName;

      byOwner.putIfAbsent(
          ownerId.toString(),
          () => {
                'name': ownerName,
                'wonCount': 0,
                'pipelineValue': 0.0,
              });

      final value =
          d['value'] is num ? (d['value'] as num).toDouble() : 0.0;

      if (d['stage'] == 'closed_won') {
        byOwner[ownerId.toString()]!['wonCount'] =
            (byOwner[ownerId.toString()]!['wonCount'] as int) + 1;
      }
      if (d['stage'] != 'closed_won' && d['stage'] != 'closed_lost') {
        byOwner[ownerId.toString()]!['pipelineValue'] =
            (byOwner[ownerId.toString()]!['pipelineValue'] as double) + value;
      }
    }

    final list = byOwner.values.toList();
    list.sort((a, b) =>
        (b['wonCount'] as int).compareTo(a['wonCount'] as int));
    return list.take(10).toList();
  }

  double _getNum(dynamic v) =>
      v is num ? v.toDouble() : double.tryParse(v?.toString() ?? '') ?? 0;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final user = ref.watch(authProvider).user;
    final isManager = user?.isManager ?? false;

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
                'Welcome back${user != null ? ", ${user.firstName}" : ""}',
                style: theme.textTheme.titleMedium
                    ?.copyWith(fontWeight: FontWeight.bold)),
            Text('NexCRM Dashboard',
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ],
        ),
        actions: [
          IconButton(
              icon: const Icon(Icons.refresh), onPressed: _loadDashboard),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadDashboard,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // ==================== KPI Cards ====================
            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
              childAspectRatio: 1.5,
              children: [
                _KpiCard(
                  icon: Icons.handshake_outlined,
                  label: 'Open Pipeline',
                  value: _formatCurrency(_stats['openPipeline'] ?? 0),
                  sub: '${_stats['openDeals'] ?? 0} active deals',
                  color: Colors.blue,
                  loading: _loading,
                  onTap: () => context.go('/pipeline'),
                ),
                _KpiCard(
                  icon: Icons.trending_up,
                  label: 'Revenue (30d)',
                  value: _formatCurrency(_stats['revenue30d'] ?? 0),
                  sub: '${_stats['wonDeals'] ?? 0} closed won',
                  color: Colors.green,
                  loading: _loading,
                  onTap: () => context.push('/reports'),
                ),
                _KpiCard(
                  icon: Icons.emoji_events_outlined,
                  label: 'Win Rate',
                  value: '${_stats['winRate'] ?? 0}%',
                  sub: '${_stats['wonDeals'] ?? 0} won',
                  color: Colors.purple,
                  loading: _loading,
                ),
                _KpiCard(
                  icon: Icons.people_outlined,
                  label: 'Active Contacts',
                  value: '${_stats['contacts'] ?? '-'}',
                  sub: '',
                  color: Colors.orange,
                  loading: _loading,
                  onTap: () => context.go('/contacts'),
                ),
              ],
            ),
            const SizedBox(height: 20),

            // ==================== Stale Deals Alerts ====================
            if (_staleDeals.isNotEmpty || _loading) ...[
              _SectionHeader(
                  title: 'Stale Deals',
                  onSeeAll: () => context.go('/pipeline')),
              const SizedBox(height: 8),
              if (_loading)
                const Card(
                    child: Padding(
                  padding: EdgeInsets.all(16),
                  child: Center(
                      child: SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2))),
                ))
              else
                ..._staleDeals.map((deal) => _StaleDealTile(deal: deal)),
              const SizedBox(height: 20),
            ],

            // ==================== Forecast Summary Card ====================
            if (_forecastSummary.isNotEmpty || _loading) ...[
              _SectionHeader(title: 'Revenue Forecast'),
              const SizedBox(height: 8),
              if (_loading)
                const Card(
                    child: Padding(
                  padding: EdgeInsets.all(16),
                  child: Center(
                      child: SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2))),
                ))
              else
                _ForecastSummaryCard(forecast: _forecastSummary),
              const SizedBox(height: 20),
            ],

            // ==================== Team Performance (managers only) ====================
            if (isManager && (_teamPerformance.isNotEmpty || _loading)) ...[
              _SectionHeader(
                  title: 'Team Leaderboard',
                  onSeeAll: () => context.push('/reports')),
              const SizedBox(height: 8),
              if (_loading)
                const Card(
                    child: Padding(
                  padding: EdgeInsets.all(16),
                  child: Center(
                      child: SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2))),
                ))
              else
                _TeamPerformanceCard(members: _teamPerformance),
              const SizedBox(height: 20),
            ],

            // ==================== Pipeline by Stage ====================
            if (_pipelineByStage.isNotEmpty) ...[
              _SectionHeader(
                  title: 'Pipeline by Stage',
                  onSeeAll: () => context.go('/pipeline')),
              const SizedBox(height: 8),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(children: _buildPipelineBars(theme)),
                ),
              ),
              const SizedBox(height: 20),
            ],

            // ==================== Recent Activity ====================
            _SectionHeader(
                title: 'Recent Activity',
                onSeeAll: () => context.push('/activities')),
            const SizedBox(height: 8),
            if (_recentActivities.isEmpty && !_loading)
              Card(
                  child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text('No recent activities',
                    style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant)),
              ))
            else
              ...(_recentActivities.map((a) => _ActivityTile(activity: a))),
            const SizedBox(height: 20),

            // ==================== Upcoming Tasks ====================
            _SectionHeader(
                title: 'Upcoming Tasks',
                onSeeAll: () => context.push('/tasks')),
            const SizedBox(height: 8),
            if (_upcomingTasks.isEmpty && !_loading)
              Card(
                  child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text('No pending tasks',
                    style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant)),
              ))
            else
              ...(_upcomingTasks.map((t) => _TaskTile(task: t))),
            const SizedBox(height: 20),

            // ==================== Quick Actions ====================
            Text('Quick Actions',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ActionChip(
                    avatar: const Icon(Icons.person_add, size: 18),
                    label: const Text('New Contact'),
                    onPressed: () => context.push('/contacts/new')),
                ActionChip(
                    avatar: const Icon(Icons.handshake, size: 18),
                    label: const Text('New Deal'),
                    onPressed: () => context.push('/deals/new')),
                ActionChip(
                    avatar: const Icon(Icons.task_alt, size: 18),
                    label: const Text('New Task'),
                    onPressed: () => context.push('/tasks')),
                ActionChip(
                    avatar: const Icon(Icons.business, size: 18),
                    label: const Text('New Company'),
                    onPressed: () => context.push('/companies/new')),
              ],
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  List<Widget> _buildPipelineBars(ThemeData theme) {
    const labels = {
      'lead': 'Lead',
      'qualified': 'Qualified',
      'discovery': 'Discovery',
      'proposal': 'Proposal',
      'negotiation': 'Negotiation',
      'closed_won': 'Won',
      'closed_lost': 'Lost'
    };
    const colors = {
      'lead': Colors.grey,
      'qualified': Colors.blue,
      'discovery': Colors.indigo,
      'proposal': Colors.orange,
      'negotiation': Colors.deepOrange,
      'closed_won': Colors.green,
      'closed_lost': Colors.red
    };
    final maxVal = _pipelineByStage.values.fold(0, (a, b) => a > b ? a : b);

    return _pipelineByStage.entries.map((e) {
      final pct = maxVal > 0 ? e.value / maxVal : 0.0;
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [
          SizedBox(
              width: 80,
              child: Text(labels[e.key] ?? e.key,
                  style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                      fontSize: 11))),
          Expanded(
              child: ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
                value: pct,
                backgroundColor: theme.colorScheme.surfaceContainerHighest,
                color: colors[e.key] ?? Colors.grey,
                minHeight: 10),
          )),
          const SizedBox(width: 8),
          SizedBox(
              width: 24,
              child: Text('${e.value}',
                  textAlign: TextAlign.right,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(fontWeight: FontWeight.w600, fontSize: 11))),
        ]),
      );
    }).toList();
  }

  String _formatCurrency(int value) {
    if (value >= 1000000) {
      return '\$${(value / 1000000).toStringAsFixed(1)}M';
    }
    if (value >= 1000) return '\$${(value / 1000).toStringAsFixed(0)}K';
    return '\$$value';
  }
}

// ============================================================
// Stale Deal Tile
// ============================================================
class _StaleDealTile extends StatelessWidget {
  final Map<String, dynamic> deal;
  const _StaleDealTile({required this.deal});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final now = DateTime.now();
    final lastActivity = deal['lastActivityAt'] ??
        deal['last_activity_at'] ??
        deal['updatedAt'] ??
        deal['updated_at'];

    int daysSince = deal['_daysSinceActivity'] is int
        ? deal['_daysSinceActivity'] as int
        : 0;
    if (daysSince == 0 && lastActivity != null) {
      try {
        final dt = DateTime.parse(lastActivity.toString());
        daysSince = now.difference(dt).inDays;
      } catch (_) {}
    }

    final value = deal['value'] is num ? (deal['value'] as num).toDouble() : 0.0;
    final urgencyColor = daysSince > 30
        ? Colors.red
        : daysSince > 14
            ? Colors.deepOrange
            : Colors.orange;

    return Card(
      shape: RoundedRectangleBorder(
        side: BorderSide(color: urgencyColor.withOpacity(0.3)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: ListTile(
        dense: true,
        leading: Container(
          padding: const EdgeInsets.all(6),
          decoration: BoxDecoration(
            color: urgencyColor.withOpacity(0.1),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(Icons.warning_amber_rounded, size: 20, color: urgencyColor),
        ),
        title: Text(
          deal['name'] ?? 'Untitled Deal',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
        ),
        subtitle: Row(
          children: [
            Text(
              '$daysSince days inactive',
              style: TextStyle(
                  fontSize: 11,
                  color: urgencyColor,
                  fontWeight: FontWeight.w600),
            ),
            if (value > 0) ...[
              const SizedBox(width: 8),
              Text(
                _fmtValue(value),
                style: TextStyle(
                    fontSize: 11,
                    color: theme.colorScheme.onSurfaceVariant),
              ),
            ],
          ],
        ),
        trailing: Icon(Icons.chevron_right, size: 18, color: urgencyColor),
        onTap: () {
          if (deal['id'] != null) {
            context.push('/deals/${deal['id']}');
          }
        },
      ),
    );
  }

  String _fmtValue(double v) {
    if (v >= 1000000) return '\$${(v / 1000000).toStringAsFixed(1)}M';
    if (v >= 1000) return '\$${(v / 1000).toStringAsFixed(1)}K';
    return '\$${v.toStringAsFixed(0)}';
  }
}

// ============================================================
// Forecast Summary Card
// ============================================================
class _ForecastSummaryCard extends StatelessWidget {
  final Map<String, dynamic> forecast;
  const _ForecastSummaryCard({required this.forecast});

  double _getNum(dynamic v) =>
      v is num ? v.toDouble() : double.tryParse(v?.toString() ?? '') ?? 0;

  String _fmtCurrency(double v) {
    if (v >= 1000000) return '\$${(v / 1000000).toStringAsFixed(1)}M';
    if (v >= 1000) return '\$${(v / 1000).toStringAsFixed(1)}K';
    return '\$${v.toStringAsFixed(0)}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final likely = _getNum(forecast['likely'] ?? forecast['likelyRevenue']);
    final possible =
        _getNum(forecast['possible'] ?? forecast['possibleRevenue']);
    final atRisk = _getNum(forecast['atRisk'] ?? forecast['atRiskRevenue']);
    final total = likely + possible + atRisk;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Stacked bar
            if (total > 0) ...[
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: SizedBox(
                  height: 12,
                  child: Row(
                    children: [
                      if (likely > 0)
                        Expanded(
                          flex: (likely / total * 100).round(),
                          child: Container(color: Colors.green),
                        ),
                      if (possible > 0)
                        Expanded(
                          flex: (possible / total * 100).round(),
                          child: Container(color: Colors.amber),
                        ),
                      if (atRisk > 0)
                        Expanded(
                          flex: (atRisk / total * 100).round(),
                          child: Container(color: Colors.red.shade400),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 14),
            ],

            // Likely row
            _ForecastRow(
              color: Colors.green,
              label: 'Likely (>70%)',
              value: _fmtCurrency(likely),
              icon: Icons.thumb_up_outlined,
            ),
            const SizedBox(height: 10),

            // Possible row
            _ForecastRow(
              color: Colors.amber.shade700,
              label: 'Possible (30-70%)',
              value: _fmtCurrency(possible),
              icon: Icons.help_outline,
            ),
            const SizedBox(height: 10),

            // At risk row
            _ForecastRow(
              color: Colors.red,
              label: 'At Risk (<30%)',
              value: _fmtCurrency(atRisk),
              icon: Icons.warning_amber_rounded,
            ),

            if (total > 0) ...[
              const Divider(height: 20),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Total Weighted Pipeline',
                      style: theme.textTheme.bodySmall?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: theme.colorScheme.onSurfaceVariant)),
                  Text(_fmtCurrency(total),
                      style: theme.textTheme.titleSmall
                          ?.copyWith(fontWeight: FontWeight.bold)),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ForecastRow extends StatelessWidget {
  final Color color;
  final String label;
  final String value;
  final IconData icon;

  const _ForecastRow({
    required this.color,
    required this.label,
    required this.value,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(3),
          ),
        ),
        const SizedBox(width: 8),
        Icon(icon, size: 14, color: color),
        const SizedBox(width: 6),
        Expanded(
          child: Text(label,
              style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant)),
        ),
        Text(value,
            style: TextStyle(
                fontSize: 14, fontWeight: FontWeight.w600, color: color)),
      ],
    );
  }
}

// ============================================================
// Team Performance Card (Manager/Admin)
// ============================================================
class _TeamPerformanceCard extends StatelessWidget {
  final List<Map<String, dynamic>> members;
  const _TeamPerformanceCard({required this.members});

  String _fmtCurrency(double v) {
    if (v >= 1000000) return '\$${(v / 1000000).toStringAsFixed(1)}M';
    if (v >= 1000) return '\$${(v / 1000).toStringAsFixed(1)}K';
    return '\$${v.toStringAsFixed(0)}';
  }

  double _getNum(dynamic v) =>
      v is num ? v.toDouble() : double.tryParse(v?.toString() ?? '') ?? 0;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.leaderboard_outlined,
                    size: 18, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text('Top Performers',
                    style: theme.textTheme.titleSmall
                        ?.copyWith(fontWeight: FontWeight.w600)),
              ],
            ),
            const SizedBox(height: 12),
            ...members.asMap().entries.map((entry) {
              final index = entry.key;
              final m = entry.value;
              final name = m['name'] ??
                  m['fullName'] ??
                  m['userName'] ??
                  'Unknown';
              final wonCount = m['wonCount'] ??
                  m['won_count'] ??
                  m['dealsWon'] ??
                  m['deals_won'] ??
                  0;
              final pipelineValue = _getNum(m['pipelineValue'] ??
                  m['pipeline_value'] ??
                  m['totalPipeline'] ??
                  0);

              final isTop3 = index < 3;
              final medalIcon = index == 0
                  ? Icons.emoji_events
                  : index == 1
                      ? Icons.emoji_events_outlined
                      : null;
              final medalColor = index == 0
                  ? Colors.amber
                  : index == 1
                      ? Colors.grey.shade400
                      : Colors.brown.shade300;

              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    SizedBox(
                      width: 24,
                      child: isTop3 && medalIcon != null
                          ? Icon(medalIcon, size: 16, color: medalColor)
                          : Text('${index + 1}',
                              textAlign: TextAlign.center,
                              style: theme.textTheme.bodySmall?.copyWith(
                                  color:
                                      theme.colorScheme.onSurfaceVariant,
                                  fontWeight: FontWeight.w600)),
                    ),
                    const SizedBox(width: 8),
                    CircleAvatar(
                      radius: 14,
                      backgroundColor:
                          theme.colorScheme.primaryContainer,
                      child: Text(
                        (name as String).isNotEmpty
                            ? name[0].toUpperCase()
                            : '?',
                        style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: theme.colorScheme.onPrimaryContainer),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              fontSize: 13,
                              fontWeight: isTop3
                                  ? FontWeight.w600
                                  : FontWeight.normal)),
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text('$wonCount won',
                            style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                color: Colors.green.shade700)),
                        if (pipelineValue > 0)
                          Text(_fmtCurrency(pipelineValue),
                              style: TextStyle(
                                  fontSize: 10,
                                  color: theme
                                      .colorScheme.onSurfaceVariant)),
                      ],
                    ),
                  ],
                ),
              );
            }),
          ],
        ),
      ),
    );
  }
}

// ============================================================
// Shared Widgets (existing)
// ============================================================
class _KpiCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final String sub;
  final Color color;
  final bool loading;
  final VoidCallback? onTap;

  const _KpiCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.sub,
    required this.color,
    this.loading = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Expanded(
                              child: Text(label,
                                  style: theme.textTheme.bodySmall?.copyWith(
                                      color: theme
                                          .colorScheme.onSurfaceVariant),
                                  overflow: TextOverflow.ellipsis)),
                          Container(
                              padding: const EdgeInsets.all(6),
                              decoration: BoxDecoration(
                                  color: color.withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(8)),
                              child: Icon(icon, size: 16, color: color)),
                        ]),
                    loading
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child:
                                CircularProgressIndicator(strokeWidth: 2))
                        : Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                                Text(value,
                                    style: theme.textTheme.titleLarge
                                        ?.copyWith(
                                            fontWeight: FontWeight.bold)),
                                if (sub.isNotEmpty)
                                  Text(sub,
                                      style: theme.textTheme.bodySmall
                                          ?.copyWith(
                                              color: theme.colorScheme
                                                  .onSurfaceVariant,
                                              fontSize: 10)),
                              ]),
                  ]),
            )));
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  final VoidCallback? onSeeAll;
  const _SectionHeader({required this.title, this.onSeeAll});
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(title,
              style: theme.textTheme.titleSmall
                  ?.copyWith(fontWeight: FontWeight.w600)),
          if (onSeeAll != null)
            GestureDetector(
                onTap: onSeeAll,
                child: Text('See all',
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: theme.colorScheme.primary))),
        ]);
  }
}

class _ActivityTile extends StatelessWidget {
  final Map<String, dynamic> activity;
  const _ActivityTile({required this.activity});

  IconData _iconFor(String type) {
    switch (type) {
      case 'email':
        return Icons.mail_outlined;
      case 'call':
        return Icons.phone_outlined;
      case 'meeting':
        return Icons.event_outlined;
      case 'note':
        return Icons.note_outlined;
      default:
        return Icons.timeline;
    }
  }

  Color _colorFor(String type) {
    switch (type) {
      case 'email':
        return Colors.blue;
      case 'call':
        return Colors.green;
      case 'meeting':
        return Colors.purple;
      case 'note':
        return Colors.orange;
      default:
        return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    final type = activity['type'] ?? 'note';
    final color = _colorFor(type);
    return Card(
        child: ListTile(
      dense: true,
      leading: Container(
          padding: const EdgeInsets.all(6),
          decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              borderRadius: BorderRadius.circular(8)),
          child: Icon(_iconFor(type), size: 18, color: color)),
      title: Text(activity['notes'] ?? activity['subject'] ?? type,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 13)),
      subtitle: Text(activity['createdAt'] ?? '',
          style: const TextStyle(fontSize: 11)),
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
    return Card(
        child: ListTile(
      dense: true,
      leading: Icon(
          completed
              ? Icons.check_circle
              : Icons.radio_button_unchecked,
          color: completed
              ? Colors.green
              : theme.colorScheme.onSurfaceVariant,
          size: 20),
      title: Text(task['title'] ?? 'Untitled',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
              fontSize: 13,
              decoration:
                  completed ? TextDecoration.lineThrough : null)),
      subtitle: task['dueDate'] != null || task['due_date'] != null
          ? Text('Due: ${task['dueDate'] ?? task['due_date']}',
              style: const TextStyle(fontSize: 11))
          : null,
    ));
  }
}
