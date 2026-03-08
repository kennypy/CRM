import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

// ── Constants ────────────────────────────────────────────────────────────────

const _personaTabs = ['Rep', 'Manager', 'Executive'];
const _periodOptions = ['7d', '30d', '90d'];

// ── Demo Data ────────────────────────────────────────────────────────────────

const _activityData = {
  '7d': {'emails': 142, 'calls': 67, 'meetings': 18, 'tasks': 53, 'total': 280},
  '30d': {'emails': 632, 'calls': 284, 'meetings': 72, 'tasks': 214, 'total': 1202},
  '90d': {'emails': 1840, 'calls': 812, 'meetings': 198, 'tasks': 624, 'total': 3474},
};

const _engagementMetrics = {
  'openRate': {'value': 62.4, 'delta': 4.2, 'benchmark': 58.0},
  'replyRate': {'value': 18.7, 'delta': -1.3, 'benchmark': 15.0},
  'responseRate': {'value': 34.2, 'delta': 2.8, 'benchmark': 30.0},
  'bounceRate': {'value': 2.1, 'delta': -0.5, 'benchmark': 3.0},
};

const _callMetrics = {
  'connectRate': {'value': 32.4, 'delta': 3.1},
  'avgDuration': {'value': 4.2, 'delta': 0.3},
  'talkTimeRatio': {'value': 58.0, 'delta': -2.0},
  'callsPerDay': {'value': 14.2, 'delta': 1.8},
};

const _pipelineMetrics = {
  'dealsInPipeline': {'value': 42, 'delta': 12},
  'avgDealSize': {'value': 130000, 'delta': 5},
  'velocity': {'value': 34, 'delta': -3},
  'winRate': {'value': 68.0, 'delta': 4.2},
};

final _teamMembers = <Map<String, dynamic>>[
  {'name': 'Sarah Kim', 'role': 'AE', 'activities': 312, 'pipeline': 1420000, 'winRate': 72, 'trend': 'up'},
  {'name': 'Marcus Chen', 'role': 'AE', 'activities': 287, 'pipeline': 980000, 'winRate': 63, 'trend': 'up'},
  {'name': 'Priya Sharma', 'role': 'AE', 'activities': 264, 'pipeline': 870000, 'winRate': 57, 'trend': 'up'},
  {'name': 'James Wilson', 'role': 'AE', 'activities': 198, 'pipeline': 640000, 'winRate': 44, 'trend': 'down'},
  {'name': 'Lisa Park', 'role': 'SDR', 'activities': 342, 'pipeline': 520000, 'winRate': 0, 'trend': 'up'},
  {'name': 'Alex Torres', 'role': 'AE', 'activities': 145, 'pipeline': 380000, 'winRate': 38, 'trend': 'up'},
];

const _teamBenchmarks = {
  'activitiesPerWeek': 60,
  'pipelineMinimum': 500000,
  'winRateTarget': 55,
};

final _coachingAlerts = <Map<String, dynamic>>[
  {'rep': 'James Wilson', 'issue': 'Win rate 44% (target 55%)', 'severity': 'high', 'suggestion': 'Review lost deal patterns. Consider joint calls with top performer.'},
  {'rep': 'Alex Torres', 'issue': 'Ramp week 6 -- pipeline below target', 'severity': 'medium', 'suggestion': 'Schedule weekly 1:1 pipeline review. Assign shadow opportunities.'},
  {'rep': 'James Wilson', 'issue': 'Call volume 52 (team avg 74)', 'severity': 'medium', 'suggestion': 'Set daily call targets. Review time allocation.'},
];

final _execRevenueWaterfall = <Map<String, dynamic>>[
  {'label': 'Beginning Pipeline', 'value': 8200000, 'type': 'neutral'},
  {'label': 'New Pipeline', 'value': 2340000, 'type': 'positive'},
  {'label': 'Moved Up', 'value': 1450000, 'type': 'positive'},
  {'label': 'Moved Down', 'value': -820000, 'type': 'negative'},
  {'label': 'Closed Won', 'value': -2100000, 'type': 'won'},
  {'label': 'Closed Lost', 'value': -1430000, 'type': 'negative'},
  {'label': 'Ending Pipeline', 'value': 7640000, 'type': 'neutral'},
];

final _winLossBySegment = <Map<String, dynamic>>[
  {'segment': 'Enterprise', 'won': 8, 'lost': 3, 'winRate': 72.7, 'avgDealSize': 280000},
  {'segment': 'Mid-Market', 'won': 12, 'lost': 5, 'winRate': 70.6, 'avgDealSize': 95000},
  {'segment': 'SMB', 'won': 14, 'lost': 8, 'winRate': 63.6, 'avgDealSize': 28000},
  {'segment': 'Strategic', 'won': 3, 'lost': 2, 'winRate': 60.0, 'avgDealSize': 520000},
];

// ── Main Screen ──────────────────────────────────────────────────────────────

class InsightsScreen extends ConsumerStatefulWidget {
  const InsightsScreen({super.key});

  @override
  ConsumerState<InsightsScreen> createState() => _InsightsScreenState();
}

class _InsightsScreenState extends ConsumerState<InsightsScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _loading = true;
  String? _error;
  String _selectedPeriod = '30d';

  // Data
  Map<String, dynamic> _activity = {};
  Map<String, dynamic> _engagement = {};
  Map<String, dynamic> _calls = {};
  Map<String, dynamic> _pipeline = {};
  List<Map<String, dynamic>> _team = [];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _loadData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        ApiClient.instance.dio.get(Endpoints.insightsActivity,
            queryParameters: {'period': _selectedPeriod}),
        ApiClient.instance.dio.get(Endpoints.insightsEngagement,
            queryParameters: {'period': _selectedPeriod}),
        ApiClient.instance.dio.get(Endpoints.insightsPipeline,
            queryParameters: {'period': _selectedPeriod}),
        ApiClient.instance.dio.get(Endpoints.insightsTeam,
            queryParameters: {'period': _selectedPeriod}),
      ]);

      if (mounted) {
        setState(() {
          _activity = results[0].data['data'] is Map
              ? Map<String, dynamic>.from(results[0].data['data'])
              : _activityData[_selectedPeriod]!;
          _engagement = results[1].data['data'] is Map
              ? Map<String, dynamic>.from(results[1].data['data'])
              : Map<String, dynamic>.from(_engagementMetrics);
          _pipeline = results[2].data['data'] is Map
              ? Map<String, dynamic>.from(results[2].data['data'])
              : Map<String, dynamic>.from(_pipelineMetrics);
          _team = results[3].data['data'] is List
              ? List<Map<String, dynamic>>.from(results[3].data['data'])
              : _teamMembers;
          _calls = Map<String, dynamic>.from(_callMetrics);
        });
      }
    } catch (_) {
      // Fall back to demo data
      if (mounted) {
        setState(() {
          _activity = Map<String, dynamic>.from(_activityData[_selectedPeriod]!);
          _engagement = Map<String, dynamic>.from(_engagementMetrics);
          _calls = Map<String, dynamic>.from(_callMetrics);
          _pipeline = Map<String, dynamic>.from(_pipelineMetrics);
          _team = _teamMembers;
        });
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Sales Insights'),
            Text(
              'Intelligence dashboard',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadData),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: _personaTabs
              .map((t) => Tab(text: t))
              .toList(),
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? ErrorView(message: _error!, onRetry: _loadData)
              : Column(
                  children: [
                    // Period selector
                    _PeriodSelector(
                      selected: _selectedPeriod,
                      onChanged: (period) {
                        setState(() => _selectedPeriod = period);
                        _loadData();
                      },
                    ),
                    Expanded(
                      child: TabBarView(
                        controller: _tabController,
                        children: [
                          _buildRepTab(theme),
                          _buildManagerTab(theme),
                          _buildExecTab(theme),
                        ],
                      ),
                    ),
                  ],
                ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 1: Rep View
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildRepTab(ThemeData theme) {
    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          // Activity metrics
          _SectionLabel(label: 'ACTIVITY'),
          const SizedBox(height: 8),
          Row(
            children: [
              _MetricCard(
                icon: Icons.email_outlined,
                label: 'Emails',
                value: '${_activity['emails'] ?? 0}',
                color: Colors.blue,
              ),
              const SizedBox(width: 8),
              _MetricCard(
                icon: Icons.phone_outlined,
                label: 'Calls',
                value: '${_activity['calls'] ?? 0}',
                color: Colors.green,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              _MetricCard(
                icon: Icons.calendar_today_outlined,
                label: 'Meetings',
                value: '${_activity['meetings'] ?? 0}',
                color: Colors.orange,
              ),
              const SizedBox(width: 8),
              _MetricCard(
                icon: Icons.check_box_outlined,
                label: 'Tasks',
                value: '${_activity['tasks'] ?? 0}',
                color: Colors.purple,
              ),
            ],
          ),
          const SizedBox(height: 20),

          // Engagement metrics
          _SectionLabel(label: 'ENGAGEMENT'),
          const SizedBox(height: 8),
          _EngagementRow(
            label: 'Open Rate',
            value: _getMetricValue(_engagement, 'openRate', 'value'),
            delta: _getMetricValue(_engagement, 'openRate', 'delta'),
            benchmark: _getMetricValue(_engagement, 'openRate', 'benchmark'),
            suffix: '%',
          ),
          _EngagementRow(
            label: 'Reply Rate',
            value: _getMetricValue(_engagement, 'replyRate', 'value'),
            delta: _getMetricValue(_engagement, 'replyRate', 'delta'),
            benchmark: _getMetricValue(_engagement, 'replyRate', 'benchmark'),
            suffix: '%',
          ),
          _EngagementRow(
            label: 'Response Rate',
            value: _getMetricValue(_engagement, 'responseRate', 'value'),
            delta: _getMetricValue(_engagement, 'responseRate', 'delta'),
            benchmark: _getMetricValue(_engagement, 'responseRate', 'benchmark'),
            suffix: '%',
          ),
          _EngagementRow(
            label: 'Bounce Rate',
            value: _getMetricValue(_engagement, 'bounceRate', 'value'),
            delta: _getMetricValue(_engagement, 'bounceRate', 'delta'),
            benchmark: _getMetricValue(_engagement, 'bounceRate', 'benchmark'),
            suffix: '%',
            inverseTrend: true,
          ),
          const SizedBox(height: 20),

          // Call metrics
          _SectionLabel(label: 'CALLS'),
          const SizedBox(height: 8),
          Row(
            children: [
              _MetricCardWithTrend(
                label: 'Connect Rate',
                value: '${_getCallValue('connectRate', 'value').toStringAsFixed(1)}%',
                delta: _getCallValue('connectRate', 'delta'),
              ),
              const SizedBox(width: 8),
              _MetricCardWithTrend(
                label: 'Avg Duration',
                value: '${_getCallValue('avgDuration', 'value').toStringAsFixed(1)}m',
                delta: _getCallValue('avgDuration', 'delta'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              _MetricCardWithTrend(
                label: 'Talk Ratio',
                value: '${_getCallValue('talkTimeRatio', 'value').toStringAsFixed(0)}%',
                delta: _getCallValue('talkTimeRatio', 'delta'),
              ),
              const SizedBox(width: 8),
              _MetricCardWithTrend(
                label: 'Calls/Day',
                value: _getCallValue('callsPerDay', 'value').toStringAsFixed(1),
                delta: _getCallValue('callsPerDay', 'delta'),
              ),
            ],
          ),
          const SizedBox(height: 20),

          // Pipeline health
          _SectionLabel(label: 'PIPELINE HEALTH'),
          const SizedBox(height: 8),
          Row(
            children: [
              _MetricCardWithTrend(
                label: 'Deals',
                value: '${_getPipelineValue('dealsInPipeline', 'value').toInt()}',
                delta: _getPipelineValue('dealsInPipeline', 'delta'),
              ),
              const SizedBox(width: 8),
              _MetricCardWithTrend(
                label: 'Avg Deal Size',
                value: _formatCurrency(_getPipelineValue('avgDealSize', 'value')),
                delta: _getPipelineValue('avgDealSize', 'delta'),
                deltaIsPercent: true,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              _MetricCardWithTrend(
                label: 'Velocity (days)',
                value: '${_getPipelineValue('velocity', 'value').toInt()}',
                delta: _getPipelineValue('velocity', 'delta'),
                inverseTrend: true,
              ),
              const SizedBox(width: 8),
              _MetricCardWithTrend(
                label: 'Win Rate',
                value: '${_getPipelineValue('winRate', 'value').toStringAsFixed(1)}%',
                delta: _getPipelineValue('winRate', 'delta'),
              ),
            ],
          ),
          const SizedBox(height: 20),
        ],
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 2: Manager View
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildManagerTab(ThemeData theme) {
    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          // Team performance
          _SectionLabel(label: 'TEAM PERFORMANCE'),
          const SizedBox(height: 8),
          ..._team.map((member) => _TeamMemberCard(
                member: member,
                benchmarks: _teamBenchmarks,
              )),
          const SizedBox(height: 20),

          // Coaching alerts
          _SectionLabel(label: 'COACHING ALERTS'),
          const SizedBox(height: 8),
          ..._coachingAlerts.map((alert) => _CoachingAlertCard(alert: alert)),
          const SizedBox(height: 20),

          // Team benchmarks
          _SectionLabel(label: 'BENCHMARKS'),
          const SizedBox(height: 8),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                children: [
                  _BenchmarkRow(
                    label: 'Activities / Week',
                    target: _teamBenchmarks['activitiesPerWeek']!,
                    teamAvg: _team.isNotEmpty
                        ? (_team.fold<int>(
                                0,
                                (sum, m) =>
                                    sum + ((m['activities'] as int?) ?? 0)) /
                            _team.length)
                        : 0,
                  ),
                  const Divider(height: 20),
                  _BenchmarkRow(
                    label: 'Win Rate Target',
                    target: _teamBenchmarks['winRateTarget']!.toDouble(),
                    teamAvg: _team.isNotEmpty
                        ? _team
                                .where((m) => (m['winRate'] as int?) != null && (m['winRate'] as int) > 0)
                                .fold<double>(
                                    0,
                                    (sum, m) =>
                                        sum + ((m['winRate'] as int?) ?? 0)) /
                            _team.where((m) => (m['winRate'] as int?) != null && (m['winRate'] as int) > 0).length
                        : 0,
                    suffix: '%',
                  ),
                  const Divider(height: 20),
                  _BenchmarkRow(
                    label: 'Pipeline Minimum',
                    target: _teamBenchmarks['pipelineMinimum']!.toDouble(),
                    teamAvg: _team.isNotEmpty
                        ? _team.fold<int>(
                                0,
                                (sum, m) =>
                                    sum + ((m['pipeline'] as int?) ?? 0)) /
                            _team.length
                        : 0,
                    isCurrency: true,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
        ],
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 3: Executive View
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildExecTab(ThemeData theme) {
    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          // Revenue waterfall
          _SectionLabel(label: 'PIPELINE WATERFALL'),
          const SizedBox(height: 8),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                children: _execRevenueWaterfall
                    .map((item) => _WaterfallRow(item: item))
                    .toList(),
              ),
            ),
          ),
          const SizedBox(height: 20),

          // Win/Loss by segment
          _SectionLabel(label: 'WIN / LOSS BY SEGMENT'),
          const SizedBox(height: 8),
          ..._winLossBySegment.map((seg) => _SegmentCard(segment: seg)),
          const SizedBox(height: 20),

          // Forecast accuracy placeholder
          _SectionLabel(label: 'FORECAST ACCURACY'),
          const SizedBox(height: 8),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                children: const [
                  _ForecastRow(period: 'Q1 2025', predicted: 2800000, actual: 2650000, accuracy: 94.6),
                  Divider(height: 16),
                  _ForecastRow(period: 'Q2 2025', predicted: 3100000, actual: 2920000, accuracy: 94.2),
                  Divider(height: 16),
                  _ForecastRow(period: 'Q3 2025', predicted: 3400000, actual: 3180000, accuracy: 93.5),
                  Divider(height: 16),
                  _ForecastRow(period: 'Q4 2025', predicted: 3800000, actual: 3520000, accuracy: 92.6),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
        ],
      ),
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  double _getMetricValue(
      Map<String, dynamic> data, String metric, String field) {
    final m = data[metric];
    if (m is Map) return (m[field] as num?)?.toDouble() ?? 0;
    return 0;
  }

  double _getCallValue(String metric, String field) {
    final m = _calls[metric];
    if (m is Map) return (m[field] as num?)?.toDouble() ?? 0;
    return 0;
  }

  double _getPipelineValue(String metric, String field) {
    final m = _pipeline[metric];
    if (m is Map) return (m[field] as num?)?.toDouble() ?? 0;
    return 0;
  }

  static String _formatCurrency(double value) {
    if (value >= 1000000) return '\$${(value / 1000000).toStringAsFixed(1)}M';
    if (value >= 1000) return '\$${(value / 1000).toStringAsFixed(0)}K';
    return '\$${value.toStringAsFixed(0)}';
  }
}

// ── Period Selector ──────────────────────────────────────────────────────────

class _PeriodSelector extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onChanged;

  const _PeriodSelector({required this.selected, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 52,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        itemCount: _periodOptions.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final period = _periodOptions[index];
          return FilterChip(
            label: Text(period),
            selected: selected == period,
            onSelected: (_) => onChanged(period),
          );
        },
      ),
    );
  }
}

// ── Section Label ────────────────────────────────────────────────────────────

class _SectionLabel extends StatelessWidget {
  final String label;

  const _SectionLabel({required this.label});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Text(
      label,
      style: theme.textTheme.labelSmall?.copyWith(
        fontWeight: FontWeight.w600,
        letterSpacing: 1,
        color: theme.colorScheme.onSurfaceVariant,
      ),
    );
  }
}

// ── Metric Card ──────────────────────────────────────────────────────────────

class _MetricCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color color;

  const _MetricCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, size: 20, color: color),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    value,
                    style: const TextStyle(
                        fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 11,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Metric Card With Trend ───────────────────────────────────────────────────

class _MetricCardWithTrend extends StatelessWidget {
  final String label;
  final String value;
  final double delta;
  final bool inverseTrend;
  final bool deltaIsPercent;

  const _MetricCardWithTrend({
    required this.label,
    required this.value,
    required this.delta,
    this.inverseTrend = false,
    this.deltaIsPercent = false,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isPositive = inverseTrend ? delta < 0 : delta > 0;
    final trendColor = delta == 0
        ? Colors.grey
        : isPositive
            ? Colors.green
            : Colors.red;
    final trendIcon = delta >= 0 ? Icons.arrow_upward : Icons.arrow_downward;
    final deltaText = deltaIsPercent
        ? '${delta >= 0 ? '+' : ''}${delta.toStringAsFixed(0)}%'
        : '${delta >= 0 ? '+' : ''}${delta.toStringAsFixed(1)}';

    return Expanded(
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: 4),
              Text(
                value,
                style: const TextStyle(
                    fontSize: 20, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 4),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(trendIcon, size: 12, color: trendColor),
                  const SizedBox(width: 2),
                  Text(
                    deltaText,
                    style: TextStyle(
                      fontSize: 11,
                      color: trendColor,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Engagement Row ───────────────────────────────────────────────────────────

class _EngagementRow extends StatelessWidget {
  final String label;
  final double value;
  final double delta;
  final double benchmark;
  final String suffix;
  final bool inverseTrend;

  const _EngagementRow({
    required this.label,
    required this.value,
    required this.delta,
    required this.benchmark,
    this.suffix = '',
    this.inverseTrend = false,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isPositive = inverseTrend ? delta < 0 : delta > 0;
    final trendColor = delta == 0
        ? Colors.grey
        : isPositive
            ? Colors.green
            : Colors.red;
    final vsBenchmark = value - benchmark;
    final benchmarkColor = inverseTrend
        ? (vsBenchmark <= 0 ? Colors.green : Colors.red)
        : (vsBenchmark >= 0 ? Colors.green : Colors.red);

    return Card(
      margin: const EdgeInsets.only(bottom: 6),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          children: [
            Expanded(
              flex: 3,
              child: Text(label,
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(fontWeight: FontWeight.w500)),
            ),
            Expanded(
              flex: 2,
              child: Text(
                '${value.toStringAsFixed(1)}$suffix',
                style: const TextStyle(
                    fontWeight: FontWeight.bold, fontSize: 15),
              ),
            ),
            // Trend indicator
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  delta >= 0 ? Icons.arrow_upward : Icons.arrow_downward,
                  size: 12,
                  color: trendColor,
                ),
                Text(
                  '${delta >= 0 ? '+' : ''}${delta.toStringAsFixed(1)}',
                  style: TextStyle(
                    fontSize: 11,
                    color: trendColor,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
            const SizedBox(width: 12),
            // vs benchmark
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: benchmarkColor.withOpacity(0.1),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                'vs ${benchmark.toStringAsFixed(0)}$suffix',
                style: TextStyle(
                    fontSize: 10,
                    color: benchmarkColor,
                    fontWeight: FontWeight.w500),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Team Member Card ─────────────────────────────────────────────────────────

class _TeamMemberCard extends StatelessWidget {
  final Map<String, dynamic> member;
  final Map<String, int> benchmarks;

  const _TeamMemberCard({
    required this.member,
    required this.benchmarks,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final name = member['name'] as String? ?? '';
    final role = member['role'] as String? ?? '';
    final activities = member['activities'] as int? ?? 0;
    final pipeline = member['pipeline'] as int? ?? 0;
    final winRate = member['winRate'] as int? ?? 0;
    final trend = member['trend'] as String? ?? 'up';
    final trendColor = trend == 'up' ? Colors.green : Colors.red;
    final winRateTarget = benchmarks['winRateTarget'] ?? 55;
    final winRateColor = winRate >= winRateTarget
        ? Colors.green
        : winRate > 0
            ? Colors.red
            : Colors.grey;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 16,
                  backgroundColor: trendColor.withOpacity(0.1),
                  child: Text(
                    name.isNotEmpty ? name[0] : '?',
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: trendColor,
                      fontSize: 14,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name,
                          style: const TextStyle(
                              fontWeight: FontWeight.w600, fontSize: 13)),
                      Text(role,
                          style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant)),
                    ],
                  ),
                ),
                Icon(
                  trend == 'up' ? Icons.trending_up : Icons.trending_down,
                  color: trendColor,
                  size: 20,
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                _MiniStat(label: 'Activities', value: '$activities'),
                _MiniStat(
                    label: 'Pipeline',
                    value: _InsightsScreenState._formatCurrency(
                        pipeline.toDouble())),
                _MiniStat(
                  label: 'Win Rate',
                  value: winRate > 0 ? '$winRate%' : 'N/A',
                  valueColor: winRateColor,
                ),
              ],
            ),
            const SizedBox(height: 8),
            // Pipeline bar
            ClipRRect(
              borderRadius: BorderRadius.circular(3),
              child: LinearProgressIndicator(
                value: (pipeline / (benchmarks['pipelineMinimum'] ?? 500000))
                    .clamp(0.0, 1.0),
                minHeight: 4,
                backgroundColor: Colors.grey.withOpacity(0.15),
                valueColor: AlwaysStoppedAnimation<Color>(
                    pipeline >= (benchmarks['pipelineMinimum'] ?? 500000)
                        ? Colors.green
                        : Colors.amber),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;

  const _MiniStat({
    required this.label,
    required this.value,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: TextStyle(
                  fontSize: 10,
                  color: theme.colorScheme.onSurfaceVariant,
                  fontWeight: FontWeight.w500)),
          Text(value,
              style: TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 13,
                color: valueColor,
              )),
        ],
      ),
    );
  }
}

// ── Coaching Alert Card ──────────────────────────────────────────────────────

class _CoachingAlertCard extends StatelessWidget {
  final Map<String, dynamic> alert;

  const _CoachingAlertCard({required this.alert});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final severity = alert['severity'] as String? ?? 'low';
    final color = severity == 'high'
        ? Colors.red
        : severity == 'medium'
            ? Colors.orange
            : Colors.grey;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: color.withOpacity(0.1),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Icon(Icons.lightbulb_outline, size: 16, color: color),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        alert['rep'] ?? '',
                        style: const TextStyle(
                            fontWeight: FontWeight.w600, fontSize: 13),
                      ),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: color.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(4),
                          border:
                              Border.all(color: color.withOpacity(0.3)),
                        ),
                        child: Text(
                          severity.toUpperCase(),
                          style: TextStyle(
                              fontSize: 9,
                              color: color,
                              fontWeight: FontWeight.w600),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    alert['issue'] ?? '',
                    style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    alert['suggestion'] ?? '',
                    style: TextStyle(
                        fontSize: 12, color: theme.colorScheme.primary),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Benchmark Row ────────────────────────────────────────────────────────────

class _BenchmarkRow extends StatelessWidget {
  final String label;
  final double target;
  final double teamAvg;
  final String suffix;
  final bool isCurrency;

  const _BenchmarkRow({
    required this.label,
    required this.target,
    required this.teamAvg,
    this.suffix = '',
    this.isCurrency = false,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final meetsTarget = teamAvg >= target;
    final color = meetsTarget ? Colors.green : Colors.red;

    String formatValue(double v) {
      if (isCurrency) return _InsightsScreenState._formatCurrency(v);
      return '${v.toStringAsFixed(v.truncateToDouble() == v ? 0 : 1)}$suffix';
    }

    return Row(
      children: [
        Expanded(
          child: Text(label, style: theme.textTheme.bodyMedium),
        ),
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              'Team: ${formatValue(teamAvg)}',
              style: TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                  color: color),
            ),
            Text(
              'Target: ${formatValue(target)}',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
        const SizedBox(width: 8),
        Icon(
          meetsTarget ? Icons.check_circle : Icons.warning_amber,
          size: 18,
          color: color,
        ),
      ],
    );
  }
}

// ── Waterfall Row ────────────────────────────────────────────────────────────

class _WaterfallRow extends StatelessWidget {
  final Map<String, dynamic> item;

  const _WaterfallRow({required this.item});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final label = item['label'] as String? ?? '';
    final value = (item['value'] as num?)?.toDouble() ?? 0;
    final type = item['type'] as String? ?? 'neutral';

    final color = type == 'positive'
        ? Colors.green
        : type == 'negative'
            ? Colors.red
            : type == 'won'
                ? Colors.blue
                : theme.colorScheme.onSurface;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            flex: 3,
            child: Text(label, style: theme.textTheme.bodySmall),
          ),
          Expanded(
            flex: 4,
            child: _BarSegment(value: value, maxValue: 8200000, color: color),
          ),
          const SizedBox(width: 8),
          SizedBox(
            width: 70,
            child: Text(
              _InsightsScreenState._formatCurrency(value.abs()),
              textAlign: TextAlign.right,
              style: TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 12,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BarSegment extends StatelessWidget {
  final double value;
  final double maxValue;
  final Color color;

  const _BarSegment({
    required this.value,
    required this.maxValue,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final pct = (value.abs() / maxValue).clamp(0.0, 1.0);
    return Align(
      alignment: Alignment.centerLeft,
      child: FractionallySizedBox(
        widthFactor: pct,
        child: Container(
          height: 14,
          decoration: BoxDecoration(
            color: color.withOpacity(0.25),
            borderRadius: BorderRadius.circular(3),
            border: Border.all(color: color.withOpacity(0.5), width: 0.5),
          ),
        ),
      ),
    );
  }
}

// ── Segment Card ─────────────────────────────────────────────────────────────

class _SegmentCard extends StatelessWidget {
  final Map<String, dynamic> segment;

  const _SegmentCard({required this.segment});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final name = segment['segment'] as String? ?? '';
    final won = segment['won'] as int? ?? 0;
    final lost = segment['lost'] as int? ?? 0;
    final winRate = (segment['winRate'] as num?)?.toDouble() ?? 0;
    final avgDeal = (segment['avgDealSize'] as num?)?.toDouble() ?? 0;
    final total = won + lost;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(name,
                      style: const TextStyle(
                          fontWeight: FontWeight.w600, fontSize: 14)),
                ),
                Text(
                  '${winRate.toStringAsFixed(1)}%',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                    color: winRate >= 65 ? Colors.green : Colors.amber,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            // Win/loss bar
            ClipRRect(
              borderRadius: BorderRadius.circular(3),
              child: SizedBox(
                height: 8,
                child: Row(
                  children: [
                    Expanded(
                      flex: won,
                      child: Container(color: Colors.green),
                    ),
                    if (lost > 0)
                      Expanded(
                        flex: lost,
                        child: Container(color: Colors.red.withOpacity(0.5)),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Text(
                  '$won won  /  $lost lost  ($total total)',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
                const Spacer(),
                Text(
                  'Avg ${_InsightsScreenState._formatCurrency(avgDeal)}',
                  style: theme.textTheme.bodySmall?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ── Forecast Row ─────────────────────────────────────────────────────────────

class _ForecastRow extends StatelessWidget {
  final String period;
  final double predicted;
  final double actual;
  final double accuracy;

  const _ForecastRow({
    required this.period,
    required this.predicted,
    required this.actual,
    required this.accuracy,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final accColor = accuracy >= 94 ? Colors.green : Colors.amber;

    return Row(
      children: [
        SizedBox(
          width: 70,
          child: Text(period,
              style: theme.textTheme.bodySmall
                  ?.copyWith(fontWeight: FontWeight.w600)),
        ),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text('Predicted: ',
                      style: TextStyle(
                          fontSize: 11,
                          color: theme.colorScheme.onSurfaceVariant)),
                  Text(
                    _InsightsScreenState._formatCurrency(predicted),
                    style: const TextStyle(
                        fontSize: 12, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
              Row(
                children: [
                  Text('Actual: ',
                      style: TextStyle(
                          fontSize: 11,
                          color: theme.colorScheme.onSurfaceVariant)),
                  Text(
                    _InsightsScreenState._formatCurrency(actual),
                    style: const TextStyle(
                        fontSize: 12, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: accColor.withOpacity(0.1),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(
            '${accuracy.toStringAsFixed(1)}%',
            style: TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 12,
                color: accColor),
          ),
        ),
      ],
    );
  }
}
