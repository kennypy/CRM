import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const _severityColors = {
  'critical': Colors.red,
  'high': Colors.deepOrange,
  'medium': Colors.amber,
  'low': Colors.grey,
};

const _severityIcons = {
  'critical': Icons.error,
  'high': Icons.warning_amber,
  'medium': Icons.info_outline,
  'low': Icons.lightbulb_outline,
};

const _proficiencyLabels = ['Beginner', 'Developing', 'Proficient', 'Expert'];

const _proficiencyColors = {
  'Beginner': Colors.red,
  'Developing': Colors.amber,
  'Proficient': Colors.blue,
  'Expert': Colors.green,
};

const _skillCategories = [
  'Discovery',
  'Negotiation',
  'Closing',
  'Objection Handling',
  'Product Knowledge',
];

const _skillKeys = [
  'discovery',
  'negotiation',
  'closing',
  'objectionHandling',
  'productKnowledge',
];

const _trendIcons = {
  'up': Icons.trending_up,
  'down': Icons.trending_down,
  'flat': Icons.trending_flat,
};

const _trendColors = {
  'up': Colors.green,
  'down': Colors.red,
  'flat': Colors.grey,
};

const _meetingStatusColors = {
  'completed': Colors.green,
  'upcoming': Colors.blue,
  'overdue': Colors.red,
};

const _prioritySkillGaps = [
  {
    'skill': 'Negotiation',
    'priority': 'high',
    'affectedReps': ['Sarah Chen', 'Mike Ross', 'Jake Liu'],
    'impact': 'Win rate drops 18% when deals enter negotiation phase. Reps concede on price too early.',
  },
  {
    'skill': 'Closing',
    'priority': 'high',
    'affectedReps': ['Tom Brady', 'Lisa Park'],
    'impact': 'Average deal cycle extends by 12 days due to weak closing techniques. Pipeline stalls at final stage.',
  },
  {
    'skill': 'Discovery',
    'priority': 'medium',
    'affectedReps': ['Jake Liu', 'Anna Bell', 'Tom Brady'],
    'impact': 'Deals sourced with poor discovery have 30% lower average contract value.',
  },
  {
    'skill': 'Objection Handling',
    'priority': 'medium',
    'affectedReps': ['Mike Ross', 'Anna Bell'],
    'impact': 'Competitor displacement rate is 40% below target when objections arise mid-cycle.',
  },
];

/* ------------------------------------------------------------------ */
/*  Screen                                                             */
/* ------------------------------------------------------------------ */

class CoachingScreen extends ConsumerStatefulWidget {
  const CoachingScreen({super.key});

  @override
  ConsumerState<CoachingScreen> createState() => _CoachingScreenState();
}

class _CoachingScreenState extends ConsumerState<CoachingScreen>
    with SingleTickerProviderStateMixin {
  // Data
  List<Map<String, dynamic>> _alerts = [];
  List<Map<String, dynamic>> _reps = [];
  List<Map<String, dynamic>> _skills = [];
  List<Map<String, dynamic>> _meetingInsights = [];
  List<Map<String, dynamic>> _recommendations = [];
  Map<String, dynamic> _teamMetrics = {};
  bool _loading = true;
  String? _error;

  // Tab & filter state
  late TabController _tabController;
  String _severityFilter = 'all';
  String? _repFilter;
  int? _expandedAlertIndex;
  String _meetingStatusFilter = 'all';
  int? _expandedMeetingIndex;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _loadData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  /* ---- Data loading ---- */

  Future<void> _loadData() async {
    setState(() { _loading = true; _error = null; });
    try {
      final results = await Future.wait([
        ApiClient.instance.dio.get(Endpoints.coachingAlerts).catchError((_) => null),
        ApiClient.instance.dio.get(Endpoints.coachingReps).catchError((_) => null),
        ApiClient.instance.dio.get(Endpoints.coachingSkills).catchError((_) => null),
        ApiClient.instance.dio.get(Endpoints.coachingMeetings).catchError((_) => null),
        ApiClient.instance.dio.get(Endpoints.coachingRecommendations).catchError((_) => null),
        ApiClient.instance.dio.get(Endpoints.coachingMetrics).catchError((_) => null),
      ]);

      if (mounted) {
        setState(() {
          _alerts = _extractList(results[0]?.data, 'alerts');
          _reps = _extractList(results[1]?.data, 'reps');
          _skills = _extractList(results[2]?.data, 'skills');
          _meetingInsights = _extractList(results[3]?.data, 'meetings');
          _recommendations = _extractList(results[4]?.data, 'recommendations');
          if (results[5]?.data != null) {
            final d = results[5]!.data;
            _teamMetrics = d is Map<String, dynamic> ? (d['data'] ?? d) : {};
          }
        });
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load coaching data');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> _extractList(dynamic data, String fallbackKey) {
    if (data == null) return [];
    if (data is List) return List<Map<String, dynamic>>.from(data);
    if (data is Map) {
      final items = data['data'] ?? data['items'] ?? data[fallbackKey] ?? [];
      if (items is List) return List<Map<String, dynamic>>.from(items);
    }
    return [];
  }

  /* ---- Computed ---- */

  List<Map<String, dynamic>> get _filteredAlerts {
    var list = _alerts;
    if (_severityFilter != 'all') {
      list = list.where((a) => a['severity'] == _severityFilter).toList();
    }
    if (_repFilter != null) {
      list = list.where((a) => a['rep'] == _repFilter).toList();
    }
    return list;
  }

  List<Map<String, dynamic>> get _filteredReps {
    if (_repFilter == null) return _reps;
    return _reps.where((r) => r['name'] == _repFilter || r['id'] == _repFilter).toList();
  }

  List<Map<String, dynamic>> get _filteredSkills {
    if (_repFilter == null) return _skills;
    return _skills.where((s) => s['rep'] == _repFilter || s['repName'] == _repFilter).toList();
  }

  List<Map<String, dynamic>> get _filteredMeetings {
    var list = _meetingInsights;
    if (_meetingStatusFilter != 'all') {
      list = list.where((m) => m['status'] == _meetingStatusFilter).toList();
    }
    if (_repFilter != null) {
      list = list.where((m) => m['rep'] == _repFilter).toList();
    }
    return list;
  }

  int get _highSeverityAlertCount {
    return _alerts.where((a) =>
        a['severity'] == 'critical' || a['severity'] == 'high').length;
  }

  List<String> get _repNames {
    final names = <String>{};
    for (final r in _reps) {
      final name = r['name']?.toString();
      if (name != null && name.isNotEmpty) names.add(name);
    }
    for (final a in _alerts) {
      final name = a['rep']?.toString();
      if (name != null && name.isNotEmpty) names.add(name);
    }
    return names.toList()..sort();
  }

  double _getNum(dynamic v) => v is num ? v.toDouble() : double.tryParse(v?.toString() ?? '') ?? 0;

  String _fmtCurrency(double v) {
    if (v >= 1000000) return '\$${(v / 1000000).toStringAsFixed(1)}M';
    if (v >= 1000) return '\$${(v / 1000).toStringAsFixed(0)}k';
    return '\$${v.toStringAsFixed(0)}';
  }

  /* ---- Build ---- */

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final badgeCount = _highSeverityAlertCount;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Coaching Hub'),
        actions: [
          // Rep filter dropdown
          if (_repNames.isNotEmpty)
            PopupMenuButton<String?>(
              icon: Icon(
                Icons.person_outline,
                color: _repFilter != null ? theme.colorScheme.primary : null,
              ),
              tooltip: 'Filter by rep',
              onSelected: (value) => setState(() => _repFilter = value),
              itemBuilder: (ctx) => [
                const PopupMenuItem(value: null, child: Text('All Reps')),
                const PopupMenuDivider(),
                ..._repNames.map((name) => PopupMenuItem(value: name, child: Text(name))),
              ],
            ),
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadData),
        ],
        bottom: TabBar(
          controller: _tabController,
          isScrollable: true,
          tabs: [
            Tab(
              icon: badgeCount > 0
                  ? Badge(
                      label: Text('$badgeCount'),
                      child: const Icon(Icons.warning_amber_rounded),
                    )
                  : const Icon(Icons.warning_amber_rounded),
              text: 'Alerts',
            ),
            const Tab(
              icon: Icon(Icons.people_outline),
              text: 'Performance',
            ),
            const Tab(
              icon: Icon(Icons.chat_outlined),
              text: '1:1 Notes',
            ),
            const Tab(
              icon: Icon(Icons.menu_book_outlined),
              text: 'Skills',
            ),
          ],
        ),
      ),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadData)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : TabBarView(
                  controller: _tabController,
                  children: [
                    _buildAlertsTab(theme),
                    _buildPerformanceTab(theme),
                    _buildOneOnOneNotesTab(theme),
                    _buildSkillsTab(theme),
                  ],
                ),
    );
  }

  /* ================================================================ */
  /*  Alerts Tab                                                       */
  /* ================================================================ */

  Widget _buildAlertsTab(ThemeData theme) {
    final alerts = _filteredAlerts;

    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          // Severity filter chips
          SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: ['all', 'critical', 'high', 'medium', 'low'].map((sev) {
                final selected = _severityFilter == sev;
                final count = sev == 'all'
                    ? _alerts.length
                    : _alerts.where((a) => a['severity'] == sev).length;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: FilterChip(
                    label: Text(
                      '${sev == 'all' ? 'All' : sev[0].toUpperCase() + sev.substring(1)} ($count)',
                    ),
                    selected: selected,
                    onSelected: (_) => setState(() => _severityFilter = sev),
                  ),
                );
              }).toList(),
            ),
          ),
          const SizedBox(height: 12),

          // Alert cards
          if (alerts.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 48),
              child: EmptyState(icon: Icons.check_circle_outline, title: 'No coaching alerts'),
            )
          else
            ...List.generate(alerts.length, (i) {
              final alert = alerts[i];
              return _buildAlertCard(theme, alert, i);
            }),

          // Guidance / recommendations section
          if (_recommendations.isNotEmpty) ...[
            const SizedBox(height: 16),
            Row(
              children: [
                Icon(Icons.lightbulb_outline, size: 20, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text('Recommendations',
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
              ],
            ),
            const SizedBox(height: 8),
            ..._recommendations.map((r) => _buildRecommendationCard(theme, r)),
          ],
        ],
      ),
    );
  }

  Widget _buildAlertCard(ThemeData theme, Map<String, dynamic> alert, int index) {
    final severity = alert['severity']?.toString() ?? 'low';
    final color = _severityColors[severity] ?? Colors.grey;
    final icon = _severityIcons[severity] ?? Icons.info_outline;
    final rep = alert['rep']?.toString() ?? '';
    final issue = alert['issue']?.toString() ?? '';
    final suggestion = alert['suggestion']?.toString() ?? '';
    final isExpanded = _expandedAlertIndex == index;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
        side: BorderSide(color: color.withOpacity(0.3)),
        borderRadius: BorderRadius.circular(12),
      ),
      color: color.withOpacity(0.04),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => setState(() => _expandedAlertIndex = isExpanded ? null : index),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(icon, size: 18, color: color),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(rep,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                  fontSize: 14,
                                )),
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: color.withOpacity(0.15),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                severity,
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w600,
                                  color: color,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(issue,
                            style: TextStyle(
                              fontSize: 12,
                              color: theme.colorScheme.onSurfaceVariant,
                            )),
                      ],
                    ),
                  ),
                  Icon(
                    isExpanded ? Icons.expand_less : Icons.expand_more,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ],
              ),
              if (isExpanded && suggestion.isNotEmpty) ...[
                const SizedBox(height: 8),
                const Divider(height: 1),
                const SizedBox(height: 8),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.auto_awesome, size: 14, color: Colors.amber.shade700),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('AI Suggestion',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: theme.colorScheme.onSurface,
                              )),
                          const SizedBox(height: 2),
                          Text(suggestion,
                              style: TextStyle(
                                fontSize: 12,
                                color: theme.colorScheme.onSurfaceVariant,
                                height: 1.4,
                              )),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRecommendationCard(ThemeData theme, Map<String, dynamic> rec) {
    final title = rec['title']?.toString() ?? rec['action']?.toString() ?? '';
    final description = rec['description']?.toString() ?? rec['detail']?.toString() ?? '';
    final completed = rec['completed'] == true;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Icon(
          completed ? Icons.check_circle : Icons.radio_button_unchecked,
          color: completed ? Colors.green : theme.colorScheme.onSurfaceVariant,
        ),
        title: Text(title,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w500,
              decoration: completed ? TextDecoration.lineThrough : null,
            )),
        subtitle: description.isNotEmpty
            ? Text(description, style: const TextStyle(fontSize: 12))
            : null,
      ),
    );
  }

  /* ================================================================ */
  /*  Performance Tab                                                   */
  /* ================================================================ */

  Widget _buildPerformanceTab(ThemeData theme) {
    final reps = _filteredReps;

    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          // Team metrics overview
          if (_teamMetrics.isNotEmpty) ...[
            _buildTeamMetricsRow(theme),
            const SizedBox(height: 16),
          ],

          // Meeting insights section
          if (_meetingInsights.isNotEmpty) ...[
            Row(
              children: [
                Icon(Icons.insights, size: 20, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text('Meeting Insights',
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
              ],
            ),
            const SizedBox(height: 8),
            SizedBox(
              height: 100,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: _meetingInsights.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (ctx, i) => _buildMeetingInsightCard(theme, _meetingInsights[i]),
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Rep performance cards header
          Row(
            children: [
              Icon(Icons.people_outline, size: 20, color: theme.colorScheme.primary),
              const SizedBox(width: 8),
              Text('Rep Performance',
                  style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: 8),

          if (reps.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 48),
              child: EmptyState(icon: Icons.people_outline, title: 'No rep data available'),
            )
          else
            ...reps.map((rep) => _buildRepCard(theme, rep)),
        ],
      ),
    );
  }

  Widget _buildTeamMetricsRow(ThemeData theme) {
    final avgWinRate = _getNum(_teamMetrics['avgWinRate'] ?? _teamMetrics['avg_win_rate']);
    final avgDealSize = _getNum(_teamMetrics['avgDealSize'] ?? _teamMetrics['avg_deal_size']);
    final avgCycleTime = _getNum(_teamMetrics['avgCycleTime'] ?? _teamMetrics['avg_cycle_time']);
    final totalPipeline = _getNum(_teamMetrics['totalPipeline'] ?? _teamMetrics['total_pipeline']);

    final winRateDelta = _getNum(_teamMetrics['avgWinRateDelta'] ?? _teamMetrics['avg_win_rate_delta']);
    final dealSizeDelta = _getNum(_teamMetrics['avgDealSizeDelta'] ?? _teamMetrics['avg_deal_size_delta']);
    final cycleTimeDelta = _getNum(_teamMetrics['avgCycleTimeDelta'] ?? _teamMetrics['avg_cycle_time_delta']);
    final pipelineDelta = _getNum(_teamMetrics['totalPipelineDelta'] ?? _teamMetrics['total_pipeline_delta']);

    return Column(
      children: [
        Row(
          children: [
            Expanded(child: _MetricCard(
              label: 'Avg Win Rate',
              value: '${avgWinRate.toStringAsFixed(1)}%',
              icon: Icons.track_changes,
              color: Colors.green,
              delta: winRateDelta,
              deltaLabel: '% vs last month',
            )),
            const SizedBox(width: 8),
            Expanded(child: _MetricCard(
              label: 'Avg Deal',
              value: _fmtCurrency(avgDealSize),
              icon: Icons.attach_money,
              color: Colors.blue,
              delta: dealSizeDelta,
              deltaLabel: '% vs last month',
            )),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(child: _MetricCard(
              label: 'Cycle',
              value: '${avgCycleTime.toInt()}d',
              icon: Icons.schedule,
              color: Colors.purple,
              delta: cycleTimeDelta,
              deltaLabel: 'd vs last month',
              invertColor: true,
            )),
            const SizedBox(width: 8),
            Expanded(child: _MetricCard(
              label: 'Pipeline',
              value: _fmtCurrency(totalPipeline),
              icon: Icons.bar_chart,
              color: Colors.orange,
              delta: pipelineDelta,
              deltaLabel: '% vs last month',
            )),
          ],
        ),
      ],
    );
  }

  Widget _buildMeetingInsightCard(ThemeData theme, Map<String, dynamic> meeting) {
    final rep = meeting['rep']?.toString() ?? '';
    final date = meeting['date']?.toString() ?? '';
    final score = _getNum(meeting['score']);
    final status = meeting['status']?.toString() ?? '';

    final statusColor = _meetingStatusColors[status] ?? Colors.grey;

    return Container(
      width: 180,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(rep,
                    style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                    overflow: TextOverflow.ellipsis),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: statusColor.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(status,
                    style: TextStyle(fontSize: 10, fontWeight: FontWeight.w500, color: statusColor)),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(date, style: TextStyle(fontSize: 11, color: theme.colorScheme.onSurfaceVariant)),
          const Spacer(),
          if (score > 0)
            Row(
              children: [
                Icon(Icons.star, size: 14, color: Colors.amber.shade600),
                const SizedBox(width: 4),
                Text('Score: ${score.toStringAsFixed(0)}',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: theme.colorScheme.onSurface,
                    )),
              ],
            ),
        ],
      ),
    );
  }

  Widget _buildRepCard(ThemeData theme, Map<String, dynamic> rep) {
    final name = rep['name']?.toString() ?? '';
    final role = rep['role']?.toString() ?? '';
    final winRate = _getNum(rep['winRate'] ?? rep['win_rate']);
    final winRateTarget = _getNum(rep['winRateTarget'] ?? rep['win_rate_target']);
    final pipeline = _getNum(rep['pipeline']);
    final pipelineTarget = _getNum(rep['pipelineTarget'] ?? rep['pipeline_target']);
    final activities = _getNum(rep['activities']);
    final activitiesTarget = _getNum(rep['activitiesTarget'] ?? rep['activities_target']);
    final dealsWon = _getNum(rep['dealsWon'] ?? rep['deals_won']);
    final dealsWonTarget = _getNum(rep['dealsWonTarget'] ?? rep['deals_won_target']);
    final avgDealSize = _getNum(rep['avgDealSize'] ?? rep['avg_deal_size']);
    final trend = rep['trend']?.toString() ?? 'flat';
    final trendIcon = _trendIcons[trend] ?? Icons.trending_flat;
    final trendColor = _trendColors[trend] ?? Colors.grey;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name,
                          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                      if (role.isNotEmpty)
                        Text(role, style: TextStyle(
                          fontSize: 12, color: theme.colorScheme.onSurfaceVariant)),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: trendColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(trendIcon, size: 14, color: trendColor),
                      const SizedBox(width: 4),
                      Text(
                        trend == 'up' ? 'Trending Up' : trend == 'down' ? 'Needs Attention' : 'Steady',
                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: trendColor),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Win rate
            if (winRateTarget > 0) ...[
              _buildProgressRow(theme, 'Win Rate',
                  '${winRate.toStringAsFixed(0)}%', '${winRateTarget.toStringAsFixed(0)}%',
                  winRate / winRateTarget, winRate >= winRateTarget),
              const SizedBox(height: 8),
            ],

            // Pipeline
            if (pipelineTarget > 0) ...[
              _buildProgressRow(theme, 'Pipeline',
                  _fmtCurrency(pipeline), _fmtCurrency(pipelineTarget),
                  pipeline / pipelineTarget, pipeline >= pipelineTarget),
              const SizedBox(height: 8),
            ],

            // Activity score
            if (activitiesTarget > 0) ...[
              _buildProgressRow(theme, 'Activities',
                  '${activities.toInt()}', '${activitiesTarget.toInt()}',
                  activities / activitiesTarget, activities >= activitiesTarget),
              const SizedBox(height: 8),
            ],

            // Deals Won
            if (dealsWonTarget > 0)
              _buildProgressRow(theme, 'Deals Won',
                  '${dealsWon.toInt()}', '${dealsWonTarget.toInt()}',
                  dealsWon / dealsWonTarget, dealsWon >= dealsWonTarget),

            // Avg deal size footer
            if (avgDealSize > 0) ...[
              const SizedBox(height: 10),
              const Divider(height: 1),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Avg Deal Size',
                      style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurfaceVariant)),
                  Text(_fmtCurrency(avgDealSize),
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildProgressRow(ThemeData theme, String label,
      String value, String target, double ratio, bool onTrack) {
    final clampedRatio = ratio.clamp(0.0, 1.0);
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label,
                style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurfaceVariant)),
            Text.rich(TextSpan(children: [
              TextSpan(
                text: value,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: onTrack ? Colors.green : Colors.amber.shade800,
                ),
              ),
              TextSpan(
                text: ' / $target',
                style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurfaceVariant),
              ),
            ])),
          ],
        ),
        const SizedBox(height: 4),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: clampedRatio,
            backgroundColor: theme.colorScheme.surfaceContainerHighest,
            color: onTrack ? Colors.green : Colors.amber,
            minHeight: 6,
          ),
        ),
      ],
    );
  }

  /* ================================================================ */
  /*  1:1 Notes Tab                                                    */
  /* ================================================================ */

  Widget _buildOneOnOneNotesTab(ThemeData theme) {
    final meetings = _filteredMeetings;

    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          // Status filter chips
          SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: ['all', 'upcoming', 'completed', 'overdue'].map((status) {
                final selected = _meetingStatusFilter == status;
                final count = status == 'all'
                    ? _meetingInsights.length
                    : _meetingInsights.where((m) => m['status'] == status).length;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: FilterChip(
                    label: Text(
                      '${status == 'all' ? 'All' : status[0].toUpperCase() + status.substring(1)} ($count)',
                    ),
                    selected: selected,
                    onSelected: (_) => setState(() => _meetingStatusFilter = status),
                  ),
                );
              }).toList(),
            ),
          ),
          const SizedBox(height: 12),

          // Meeting note cards
          if (meetings.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 48),
              child: EmptyState(icon: Icons.chat_outlined, title: 'No 1:1 notes available'),
            )
          else
            ...List.generate(meetings.length, (i) {
              final meeting = meetings[i];
              return _buildMeetingNoteCard(theme, meeting, i);
            }),
        ],
      ),
    );
  }

  Widget _buildMeetingNoteCard(ThemeData theme, Map<String, dynamic> meeting, int index) {
    final rep = meeting['rep']?.toString() ?? '';
    final date = meeting['date']?.toString() ?? '';
    final status = meeting['status']?.toString() ?? '';
    final statusColor = _meetingStatusColors[status] ?? Colors.grey;
    final isExpanded = _expandedMeetingIndex == index;

    final topics = meeting['topics'] is List
        ? List<String>.from(meeting['topics'])
        : <String>[];
    final actionItems = meeting['actionItems'] is List
        ? List<String>.from(meeting['actionItems'])
        : meeting['action_items'] is List
            ? List<String>.from(meeting['action_items'])
            : <String>[];

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
        side: BorderSide(color: statusColor.withOpacity(0.3)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => setState(() => _expandedMeetingIndex = isExpanded ? null : index),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(rep,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                  fontSize: 14,
                                )),
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: statusColor.withOpacity(0.15),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                status,
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w600,
                                  color: statusColor,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(date,
                            style: TextStyle(
                              fontSize: 12,
                              color: theme.colorScheme.onSurfaceVariant,
                            )),
                      ],
                    ),
                  ),
                  Icon(
                    isExpanded ? Icons.expand_less : Icons.expand_more,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ],
              ),
              if (isExpanded) ...[
                // Topics Discussed
                if (topics.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  const Divider(height: 1),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Icon(Icons.topic_outlined, size: 14, color: theme.colorScheme.primary),
                      const SizedBox(width: 6),
                      Text('Topics Discussed',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: theme.colorScheme.onSurface,
                          )),
                    ],
                  ),
                  const SizedBox(height: 4),
                  ...topics.map((topic) => Padding(
                    padding: const EdgeInsets.only(left: 20, bottom: 2),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('\u2022 ', style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurfaceVariant)),
                        Expanded(
                          child: Text(topic.toString(),
                              style: TextStyle(
                                fontSize: 12,
                                color: theme.colorScheme.onSurfaceVariant,
                                height: 1.4,
                              )),
                        ),
                      ],
                    ),
                  )),
                ],

                // Action Items
                if (actionItems.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  const Divider(height: 1),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Icon(Icons.checklist, size: 14, color: Colors.amber.shade700),
                      const SizedBox(width: 6),
                      Text('Action Items',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: theme.colorScheme.onSurface,
                          )),
                    ],
                  ),
                  const SizedBox(height: 4),
                  ...actionItems.map((item) => Padding(
                    padding: const EdgeInsets.only(left: 20, bottom: 2),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(Icons.radio_button_unchecked, size: 12,
                            color: theme.colorScheme.onSurfaceVariant),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(item.toString(),
                              style: TextStyle(
                                fontSize: 12,
                                color: theme.colorScheme.onSurfaceVariant,
                                height: 1.4,
                              )),
                        ),
                      ],
                    ),
                  )),
                ],
              ],
            ],
          ),
        ),
      ),
    );
  }

  /* ================================================================ */
  /*  Skills Tab                                                        */
  /* ================================================================ */

  Widget _buildSkillsTab(ThemeData theme) {
    final skills = _filteredSkills;

    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          // Skills header
          Row(
            children: [
              Icon(Icons.school_outlined, size: 20, color: theme.colorScheme.primary),
              const SizedBox(width: 8),
              Text('Skills Assessment',
                  style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Proficiency levels across key selling skills',
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 12),

          // Proficiency legend
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: _proficiencyLabels.map((level) {
              final color = _proficiencyColors[level] ?? Colors.grey;
              return Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(4),
                  border: Border.all(color: color.withOpacity(0.3)),
                ),
                child: Text(level,
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: color)),
              );
            }).toList(),
          ),
          const SizedBox(height: 16),

          if (skills.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 48),
              child: EmptyState(icon: Icons.school_outlined, title: 'No skills data available'),
            )
          else
            ...skills.map((entry) => _buildSkillCard(theme, entry)),

          // Priority Skill Gaps section
          const SizedBox(height: 24),
          Row(
            children: [
              Icon(Icons.priority_high, size: 20, color: Colors.deepOrange),
              const SizedBox(width: 8),
              Text('Priority Skill Gaps',
                  style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Key areas needing development across the team',
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 12),
          ..._prioritySkillGaps.map((gap) => _buildSkillGapCard(theme, gap)),
        ],
      ),
    );
  }

  Widget _buildSkillCard(ThemeData theme, Map<String, dynamic> entry) {
    final rep = entry['rep']?.toString() ?? entry['repName']?.toString() ?? '';
    final overallScore = _overallScore(entry);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(rep, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
            const SizedBox(height: 12),

            // Skill bars
            ...List.generate(_skillCategories.length, (i) {
              final key = _skillKeys[i];
              final label = _skillCategories[i];
              final level = entry[key]?.toString() ?? 'Beginner';
              final value = _proficiencyValue(level);
              final color = _proficiencyColors[level] ?? Colors.grey;

              return Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(label,
                            style: TextStyle(
                              fontSize: 12,
                              color: theme.colorScheme.onSurfaceVariant,
                            )),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: color.withOpacity(0.1),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(level,
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                                color: color,
                              )),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: value,
                        backgroundColor: theme.colorScheme.surfaceContainerHighest,
                        color: color,
                        minHeight: 6,
                      ),
                    ),
                  ],
                ),
              );
            }),

            // Overall score with progress bar
            const Divider(height: 1),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Overall',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: theme.colorScheme.onSurface,
                    )),
                Text(
                  '${(overallScore * 100).toStringAsFixed(0)}%',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                    color: theme.colorScheme.primary,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: overallScore.clamp(0.0, 1.0),
                backgroundColor: theme.colorScheme.surfaceContainerHighest,
                color: theme.colorScheme.primary,
                minHeight: 6,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSkillGapCard(ThemeData theme, Map<String, dynamic> gap) {
    final skill = gap['skill']?.toString() ?? '';
    final priority = gap['priority']?.toString() ?? 'medium';
    final affectedReps = gap['affectedReps'] is List
        ? List<String>.from(gap['affectedReps'] as List)
        : <String>[];
    final impact = gap['impact']?.toString() ?? '';

    final priorityColor = priority == 'high' ? Colors.red : Colors.amber;
    final priorityLabel = priority == 'high' ? 'High' : 'Medium';

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
        side: BorderSide(color: priorityColor.withOpacity(0.3)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(skill,
                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: priorityColor.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    priorityLabel,
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: priorityColor,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.people_outline, size: 14, color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    affectedReps.join(', '),
                    style: TextStyle(
                      fontSize: 12,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.info_outline, size: 14, color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    impact,
                    style: TextStyle(
                      fontSize: 12,
                      color: theme.colorScheme.onSurfaceVariant,
                      height: 1.4,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  double _proficiencyValue(String level) {
    switch (level) {
      case 'Expert':
        return 1.0;
      case 'Proficient':
        return 0.75;
      case 'Developing':
        return 0.5;
      case 'Beginner':
        return 0.25;
      default:
        return 0.25;
    }
  }

  double _overallScore(Map<String, dynamic> entry) {
    double total = 0;
    for (final key in _skillKeys) {
      total += _proficiencyValue(entry[key]?.toString() ?? 'Beginner');
    }
    return total / _skillKeys.length;
  }
}

/* ------------------------------------------------------------------ */
/*  Supporting widgets                                                  */
/* ------------------------------------------------------------------ */

class _MetricCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color color;
  final double delta;
  final String deltaLabel;
  final bool invertColor;

  const _MetricCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
    this.delta = 0,
    this.deltaLabel = '',
    this.invertColor = false,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    Color deltaColor;
    if (delta == 0) {
      deltaColor = Colors.grey;
    } else if (invertColor) {
      deltaColor = delta > 0 ? Colors.red : Colors.green;
    } else {
      deltaColor = delta > 0 ? Colors.green : Colors.red;
    }

    final deltaPrefix = delta > 0 ? '+' : '';

    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: color),
          const SizedBox(height: 4),
          Text(value,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.bold,
                color: color,
                fontFeatures: const [FontFeature.tabularFigures()],
              )),
          const SizedBox(height: 2),
          Text(label,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
                fontSize: 10,
              ),
              overflow: TextOverflow.ellipsis),
          if (delta != 0) ...[
            const SizedBox(height: 4),
            Row(
              children: [
                Icon(
                  delta > 0
                      ? (invertColor ? Icons.trending_down : Icons.trending_up)
                      : (invertColor ? Icons.trending_up : Icons.trending_down),
                  size: 12,
                  color: deltaColor,
                ),
                const SizedBox(width: 2),
                Expanded(
                  child: Text(
                    '$deltaPrefix${delta.toStringAsFixed(1)}$deltaLabel',
                    style: TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.w600,
                      color: deltaColor,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
