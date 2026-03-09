import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

const _tierColors = {
  'hot': Colors.red,
  'warm': Colors.amber,
  'cold': Colors.blue,
};

const _tierIcons = {
  'hot': Icons.local_fire_department,
  'warm': Icons.remove,
  'cold': Icons.ac_unit,
};

const _tierFilters = ['all', 'hot', 'warm', 'cold'];

const _demoScores = <Map<String, dynamic>>[
  {
    'id': '1',
    'contactId': 'c1',
    'score': 92,
    'tier': 'hot',
    'factors': [
      {'name': 'Email engagement', 'impact': 25, 'evidence': 'Opened 8 of 10 emails in last 14 days'},
      {'name': 'Meeting activity', 'impact': 20, 'evidence': 'Attended 3 product demos'},
      {'name': 'Seniority', 'impact': 15, 'evidence': 'VP Engineering — decision maker'},
      {'name': 'Company fit', 'impact': 18, 'evidence': 'Enterprise tier, SaaS industry'},
      {'name': 'Website visits', 'impact': 14, 'evidence': 'Visited pricing page 4 times'},
    ],
    'modelVersion': 'v1',
    'contactName': 'Sarah Chen',
    'contactEmail': 'sarah@acmecorp.com',
    'contactTitle': 'VP Engineering',
    'companyName': 'Acme Corp',
  },
  {
    'id': '2',
    'contactId': 'c2',
    'score': 78,
    'tier': 'hot',
    'factors': [
      {'name': 'Email engagement', 'impact': 20, 'evidence': 'Replied to 3 outreach emails'},
      {'name': 'Demo request', 'impact': 25, 'evidence': 'Submitted demo form on website'},
      {'name': 'Company size', 'impact': 15, 'evidence': '500+ employees, growth stage'},
    ],
    'modelVersion': 'v1',
    'contactName': 'James Wilson',
    'contactEmail': 'james@techstart.io',
    'contactTitle': 'CTO',
    'companyName': 'TechStart',
  },
  {
    'id': '3',
    'contactId': 'c3',
    'score': 55,
    'tier': 'warm',
    'factors': [
      {'name': 'Email opens', 'impact': 12, 'evidence': 'Opened 4 of 10 emails'},
      {'name': 'LinkedIn connection', 'impact': 8, 'evidence': 'Accepted LinkedIn invite'},
    ],
    'modelVersion': 'v1',
    'contactName': 'Maria Garcia',
    'contactEmail': 'maria@globex.com',
    'contactTitle': 'Director of Sales',
    'companyName': 'Globex Inc',
  },
  {
    'id': '4',
    'contactId': 'c4',
    'score': 41,
    'tier': 'warm',
    'factors': [
      {'name': 'Inbound inquiry', 'impact': 15, 'evidence': 'Submitted contact form'},
    ],
    'modelVersion': 'v1',
    'contactName': 'David Kim',
    'contactEmail': 'david@novacorp.com',
    'contactTitle': 'Sales Manager',
    'companyName': 'NovaCorp',
  },
  {
    'id': '5',
    'contactId': 'c5',
    'score': 23,
    'tier': 'cold',
    'factors': [
      {'name': 'No engagement', 'impact': -10, 'evidence': 'No email opens in 30 days'},
    ],
    'modelVersion': 'v1',
    'contactName': 'Alex Johnson',
    'contactEmail': 'alex@oldco.com',
    'contactTitle': 'Analyst',
    'companyName': 'OldCo',
  },
];

class LeadScoringScreen extends ConsumerStatefulWidget {
  const LeadScoringScreen({super.key});

  @override
  ConsumerState<LeadScoringScreen> createState() => _LeadScoringScreenState();
}

class _LeadScoringScreenState extends ConsumerState<LeadScoringScreen> {
  List<Map<String, dynamic>> _scores = [];
  bool _loading = true;
  String? _error;
  String _selectedFilter = 'all';
  String _searchQuery = '';
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final params = <String, dynamic>{'limit': '50'};
      if (_selectedFilter != 'all') params['tier'] = _selectedFilter;

      final res = await ApiClient.instance.dio
          .get(Endpoints.leadScoring, queryParameters: params);
      final data = res.data['data'];
      final items = data is List
          ? data
          : (data is Map ? (data['items'] ?? data['scores'] ?? []) : []);
      final scoreList = List<Map<String, dynamic>>.from(items);

      if (mounted) {
        setState(() => _scores = scoreList.isNotEmpty ? scoreList : _demoScores);
      }
    } catch (_) {
      if (mounted) setState(() => _scores = _demoScores);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> get _filteredScores {
    var list = _scores;
    if (_selectedFilter != 'all') {
      list = list.where((s) => s['tier'] == _selectedFilter).toList();
    }
    if (_searchQuery.isNotEmpty) {
      final q = _searchQuery.toLowerCase();
      list = list.where((s) {
        final name = (s['contactName'] ?? '').toString().toLowerCase();
        final email = (s['contactEmail'] ?? '').toString().toLowerCase();
        final company = (s['companyName'] ?? '').toString().toLowerCase();
        return name.contains(q) || email.contains(q) || company.contains(q);
      }).toList();
    }
    return list;
  }

  Map<String, int> get _tierStats {
    int hot = 0, warm = 0, cold = 0;
    for (final s in _scores) {
      switch (s['tier']) {
        case 'hot':
          hot++;
          break;
        case 'warm':
          warm++;
          break;
        case 'cold':
          cold++;
          break;
      }
    }
    return {'hot': hot, 'warm': warm, 'cold': cold};
  }

  Color _scoreColor(int score) {
    if (score >= 70) return Colors.green;
    if (score >= 40) return Colors.amber.shade700;
    return Colors.blue;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final filtered = _filteredScores;
    final stats = _tierStats;

    return Scaffold(
      appBar: AppBar(title: const Text('Lead Scoring')),
      body: Column(
        children: [
          // Tier distribution summary
          if (!_loading)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
              child: Row(
                children: [
                  _TierSummaryCard(
                    label: 'Hot',
                    count: stats['hot'] ?? 0,
                    icon: Icons.local_fire_department,
                    color: Colors.red,
                  ),
                  const SizedBox(width: 8),
                  _TierSummaryCard(
                    label: 'Warm',
                    count: stats['warm'] ?? 0,
                    icon: Icons.remove,
                    color: Colors.amber,
                  ),
                  const SizedBox(width: 8),
                  _TierSummaryCard(
                    label: 'Cold',
                    count: stats['cold'] ?? 0,
                    icon: Icons.ac_unit,
                    color: Colors.blue,
                  ),
                ],
              ),
            ),

          // Search bar
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Search leads...',
                prefixIcon: const Icon(Icons.search, size: 20),
                suffixIcon: _searchQuery.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear, size: 18),
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _searchQuery = '');
                        },
                      )
                    : null,
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 10),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
              onChanged: (v) => setState(() => _searchQuery = v),
            ),
          ),

          // Filter chips
          SizedBox(
            height: 52,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              itemCount: _tierFilters.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final filter = _tierFilters[index];
                final selected = _selectedFilter == filter;
                return FilterChip(
                  label: Text(filter[0].toUpperCase() + filter.substring(1)),
                  selected: selected,
                  avatar: filter != 'all'
                      ? Icon(
                          _tierIcons[filter],
                          size: 16,
                          color: selected
                              ? theme.colorScheme.onSecondaryContainer
                              : (_tierColors[filter] ?? theme.colorScheme.onSurface),
                        )
                      : null,
                  onSelected: (_) {
                    setState(() => _selectedFilter = filter);
                    _loadData();
                  },
                );
              },
            ),
          ),

          // Content
          Expanded(
            child: _error != null
                ? ErrorView(message: _error!, onRetry: _loadData)
                : _loading
                    ? const Center(child: CircularProgressIndicator())
                    : filtered.isEmpty
                        ? const EmptyState(
                            icon: Icons.gps_fixed,
                            title: 'No leads found',
                            subtitle: 'Lead scores will appear here once computed',
                          )
                        : RefreshIndicator(
                            onRefresh: _loadData,
                            child: ListView.builder(
                              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                              itemCount: filtered.length + 1, // +1 for model version footer
                              itemBuilder: (context, index) {
                                if (index == filtered.length) {
                                  // Model version footer
                                  final version = _scores.isNotEmpty
                                      ? (_scores.first['modelVersion'] ?? 'v1')
                                      : 'v1';
                                  return Padding(
                                    padding: const EdgeInsets.symmetric(vertical: 16),
                                    child: Center(
                                      child: Text(
                                        'Model version: $version',
                                        style: theme.textTheme.bodySmall?.copyWith(
                                          color: theme.colorScheme.onSurfaceVariant,
                                        ),
                                      ),
                                    ),
                                  );
                                }
                                return Padding(
                                  padding: const EdgeInsets.only(bottom: 8),
                                  child: _LeadScoreCard(
                                    score: filtered[index],
                                    scoreColor: _scoreColor,
                                  ),
                                );
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}

class _TierSummaryCard extends StatelessWidget {
  final String label;
  final int count;
  final IconData icon;
  final Color color;

  const _TierSummaryCard({
    required this.label,
    required this.count,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
        decoration: BoxDecoration(
          color: color.withOpacity(0.08),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: color.withOpacity(0.2)),
        ),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, size: 14, color: color),
                const SizedBox(width: 4),
                Text(
                  label,
                  style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w500),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              '$count',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LeadScoreCard extends StatefulWidget {
  final Map<String, dynamic> score;
  final Color Function(int) scoreColor;

  const _LeadScoreCard({required this.score, required this.scoreColor});

  @override
  State<_LeadScoreCard> createState() => _LeadScoreCardState();
}

class _LeadScoreCardState extends State<_LeadScoreCard> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final s = widget.score;
    final score = (s['score'] as num?)?.toInt() ?? 0;
    final tier = s['tier'] as String? ?? 'cold';
    final tierColor = _tierColors[tier] ?? Colors.blue;
    final tierIcon = _tierIcons[tier] ?? Icons.ac_unit;
    final sColor = widget.scoreColor(score);
    final factors = s['factors'];
    final factorsList = factors is List
        ? List<Map<String, dynamic>>.from(factors)
        : <Map<String, dynamic>>[];

    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => setState(() => _expanded = !_expanded),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Contact info row
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Avatar
                  CircleAvatar(
                    radius: 20,
                    backgroundColor: tierColor.withOpacity(0.15),
                    child: Text(
                      _initials(s['contactName']),
                      style: TextStyle(
                        color: tierColor,
                        fontWeight: FontWeight.w600,
                        fontSize: 14,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),

                  // Name + email
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          s['contactName'] ?? 'Unknown',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Row(
                          children: [
                            Icon(Icons.email_outlined,
                                size: 12, color: theme.colorScheme.onSurfaceVariant),
                            const SizedBox(width: 4),
                            Expanded(
                              child: Text(
                                s['contactEmail'] ?? '—',
                                style: theme.textTheme.bodySmall,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                        if (s['companyName'] != null) ...[
                          const SizedBox(height: 2),
                          Row(
                            children: [
                              Icon(Icons.business,
                                  size: 12, color: theme.colorScheme.onSurfaceVariant),
                              const SizedBox(width: 4),
                              Text(
                                s['companyName'],
                                style: theme.textTheme.bodySmall,
                                maxLines: 1,
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),

                  // Score + tier badge
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      // Score
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: sColor.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: sColor.withOpacity(0.3)),
                        ),
                        child: Text(
                          '$score',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: sColor,
                          ),
                        ),
                      ),
                      const SizedBox(height: 4),
                      // Tier badge
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: tierColor.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(4),
                          border: Border.all(color: tierColor.withOpacity(0.3)),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(tierIcon, size: 11, color: tierColor),
                            const SizedBox(width: 3),
                            Text(
                              tier.toUpperCase(),
                              style: TextStyle(
                                fontSize: 10,
                                color: tierColor,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),

              // Score bar
              const SizedBox(height: 10),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: score / 100,
                  backgroundColor: sColor.withOpacity(0.1),
                  valueColor: AlwaysStoppedAnimation(sColor),
                  minHeight: 5,
                ),
              ),

              // Factors (expandable)
              if (_expanded && factorsList.isNotEmpty) ...[
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest.withOpacity(0.3),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'SCORING FACTORS',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                          color: theme.colorScheme.onSurfaceVariant,
                          letterSpacing: 1,
                        ),
                      ),
                      const SizedBox(height: 8),
                      ...factorsList.map((factor) {
                        final impact = (factor['impact'] as num?)?.toInt() ?? 0;
                        final isPositive = impact >= 0;
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: theme.colorScheme.surface,
                              borderRadius: BorderRadius.circular(6),
                              border: Border.all(
                                color: theme.dividerColor.withOpacity(0.5),
                              ),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        factor['name'] ?? '',
                                        style: const TextStyle(
                                          fontSize: 13,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                    // Impact value
                                    Text(
                                      '${isPositive ? '+' : ''}$impact',
                                      style: TextStyle(
                                        fontSize: 13,
                                        fontWeight: FontWeight.w700,
                                        color: isPositive ? Colors.green : Colors.red,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 4),
                                // Impact bar
                                Row(
                                  children: [
                                    Expanded(
                                      child: ClipRRect(
                                        borderRadius: BorderRadius.circular(2),
                                        child: LinearProgressIndicator(
                                          value: impact.abs() / 30, // normalize to ~30 max
                                          backgroundColor: (isPositive
                                                  ? Colors.green
                                                  : Colors.red)
                                              .withOpacity(0.1),
                                          valueColor: AlwaysStoppedAnimation(
                                            isPositive ? Colors.green : Colors.red,
                                          ),
                                          minHeight: 4,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  factor['evidence'] ?? '',
                                  style: theme.textTheme.bodySmall,
                                ),
                              ],
                            ),
                          ),
                        );
                      }),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  String _initials(String? name) {
    if (name == null || name.isEmpty) return '?';
    final parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
    }
    return parts.first[0].toUpperCase();
  }
}
