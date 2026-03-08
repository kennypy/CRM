import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

// ── Data Models ──────────────────────────────────────────────────────────────

enum TerritoryType { enterprise, midMarket, smb, growth }

enum ViewMode { list, hierarchy }

class Territory {
  final String id;
  final String name;
  final String region;
  final String subRegion;
  final TerritoryType type;
  final String owner;
  final String ownerId;
  final int repCount;
  final int accountCount;
  final double pipelineValue;
  final double quota;
  final double revenue;
  final double winRate;
  final double accountCoverage;
  final double attainment;

  const Territory({
    required this.id,
    required this.name,
    required this.region,
    required this.subRegion,
    required this.type,
    required this.owner,
    required this.ownerId,
    required this.repCount,
    required this.accountCount,
    required this.pipelineValue,
    required this.quota,
    required this.revenue,
    required this.winRate,
    required this.accountCoverage,
    required this.attainment,
  });

  factory Territory.fromJson(Map<String, dynamic> json) {
    return Territory(
      id: json['id']?.toString() ?? '',
      name: json['name'] ?? '',
      region: json['region'] ?? '',
      subRegion: json['subRegion'] ?? json['sub_region'] ?? '',
      type: _parseType(json['type'] ?? ''),
      owner: json['owner'] ?? '',
      ownerId: json['ownerId'] ?? json['owner_id'] ?? '',
      repCount: (json['repCount'] ?? json['rep_count'] ?? 0) as int,
      accountCount: (json['accountCount'] ?? json['account_count'] ?? 0) as int,
      pipelineValue:
          (json['pipelineValue'] ?? json['pipeline_value'] ?? 0).toDouble(),
      quota: (json['quota'] ?? 0).toDouble(),
      revenue: (json['revenue'] ?? 0).toDouble(),
      winRate: (json['winRate'] ?? json['win_rate'] ?? 0).toDouble(),
      accountCoverage:
          (json['accountCoverage'] ?? json['account_coverage'] ?? 0).toDouble(),
      attainment: (json['attainment'] ?? 0).toDouble(),
    );
  }

  static TerritoryType _parseType(String t) {
    switch (t.toLowerCase()) {
      case 'enterprise':
        return TerritoryType.enterprise;
      case 'mid-market':
      case 'mid_market':
      case 'midmarket':
        return TerritoryType.midMarket;
      case 'smb':
        return TerritoryType.smb;
      case 'growth':
        return TerritoryType.growth;
      default:
        return TerritoryType.enterprise;
    }
  }
}

class AssignmentRule {
  final String id;
  final String name;
  final String territoryId;
  final String territoryName;
  final List<Map<String, String>> conditions;
  final int priority;
  final bool active;

  const AssignmentRule({
    required this.id,
    required this.name,
    required this.territoryId,
    required this.territoryName,
    required this.conditions,
    required this.priority,
    required this.active,
  });

  factory AssignmentRule.fromJson(Map<String, dynamic> json) {
    final rawConds = json['conditions'] as List? ?? [];
    final conds = rawConds
        .map((c) => Map<String, String>.from({
              'field': (c['field'] ?? '').toString(),
              'operator': (c['operator'] ?? '').toString(),
              'value': (c['value'] ?? '').toString(),
            }))
        .toList();
    return AssignmentRule(
      id: json['id']?.toString() ?? '',
      name: json['name'] ?? '',
      territoryId: json['territoryId'] ?? json['territory_id'] ?? '',
      territoryName: json['territoryName'] ?? json['territory_name'] ?? '',
      conditions: conds,
      priority: (json['priority'] ?? 0) as int,
      active: json['active'] == true,
    );
  }
}

class _HierarchyNode {
  final String region;
  final List<_SubRegionNode> subRegions;
  const _HierarchyNode({required this.region, required this.subRegions});
}

class _SubRegionNode {
  final String name;
  final List<Territory> territories;
  const _SubRegionNode({required this.name, required this.territories});
}

// ── Constants ────────────────────────────────────────────────────────────────

const _kTypeLabels = <TerritoryType, String>{
  TerritoryType.enterprise: 'Enterprise',
  TerritoryType.midMarket: 'Mid-Market',
  TerritoryType.smb: 'SMB',
  TerritoryType.growth: 'Growth',
};

const _kTypeColors = <TerritoryType, Color>{
  TerritoryType.enterprise: Colors.blue,
  TerritoryType.midMarket: Colors.green,
  TerritoryType.smb: Colors.amber,
  TerritoryType.growth: Colors.purple,
};

const _kFilterTypes = <String, TerritoryType?>{
  'All': null,
  'Enterprise': TerritoryType.enterprise,
  'Mid-Market': TerritoryType.midMarket,
  'SMB': TerritoryType.smb,
  'Growth': TerritoryType.growth,
};

const _kDemoTerritories = <Map<String, dynamic>>[
  {
    'id': 't1',
    'name': 'US Northeast Enterprise',
    'region': 'North America',
    'subRegion': 'US East',
    'type': 'enterprise',
    'owner': 'Sarah Chen',
    'ownerId': 'u1',
    'repCount': 8,
    'accountCount': 124,
    'pipelineValue': 4850000,
    'quota': 6000000,
    'revenue': 3420000,
    'winRate': 34,
    'accountCoverage': 78,
    'attainment': 57,
  },
  {
    'id': 't2',
    'name': 'US West Mid-Market',
    'region': 'North America',
    'subRegion': 'US West',
    'type': 'mid-market',
    'owner': 'James Park',
    'ownerId': 'u2',
    'repCount': 6,
    'accountCount': 210,
    'pipelineValue': 2340000,
    'quota': 3500000,
    'revenue': 2180000,
    'winRate': 41,
    'accountCoverage': 65,
    'attainment': 62,
  },
  {
    'id': 't3',
    'name': 'EMEA DACH Enterprise',
    'region': 'EMEA',
    'subRegion': 'DACH',
    'type': 'enterprise',
    'owner': 'Lena Mueller',
    'ownerId': 'u3',
    'repCount': 5,
    'accountCount': 87,
    'pipelineValue': 3150000,
    'quota': 4200000,
    'revenue': 2750000,
    'winRate': 38,
    'accountCoverage': 82,
    'attainment': 65,
  },
  {
    'id': 't4',
    'name': 'APAC Growth',
    'region': 'APAC',
    'subRegion': 'Southeast Asia',
    'type': 'growth',
    'owner': 'Kevin Tan',
    'ownerId': 'u4',
    'repCount': 4,
    'accountCount': 156,
    'pipelineValue': 1280000,
    'quota': 2000000,
    'revenue': 890000,
    'winRate': 28,
    'accountCoverage': 45,
    'attainment': 44,
  },
  {
    'id': 't5',
    'name': 'UK & Ireland SMB',
    'region': 'EMEA',
    'subRegion': 'UK & Ireland',
    'type': 'smb',
    'owner': 'Emily Shaw',
    'ownerId': 'u5',
    'repCount': 3,
    'accountCount': 340,
    'pipelineValue': 890000,
    'quota': 1500000,
    'revenue': 1120000,
    'winRate': 45,
    'accountCoverage': 52,
    'attainment': 75,
  },
  {
    'id': 't6',
    'name': 'LATAM Mid-Market',
    'region': 'LATAM',
    'subRegion': 'Brazil & Southern Cone',
    'type': 'mid-market',
    'owner': 'Carlos Mendez',
    'ownerId': 'u6',
    'repCount': 4,
    'accountCount': 98,
    'pipelineValue': 1560000,
    'quota': 2200000,
    'revenue': 1340000,
    'winRate': 32,
    'accountCoverage': 60,
    'attainment': 61,
  },
];

const _kDemoRules = <Map<String, dynamic>>[
  {
    'id': 'r1',
    'name': 'US Enterprise by Country',
    'territoryId': 't1',
    'territoryName': 'US Northeast Enterprise',
    'conditions': [
      {'field': 'country', 'operator': 'in', 'value': 'US, Canada'},
      {'field': 'employees', 'operator': 'gt', 'value': '1000'},
      {'field': 'revenue', 'operator': 'gt', 'value': '\$50M'},
    ],
    'priority': 1,
    'active': true,
  },
  {
    'id': 'r2',
    'name': 'DACH Region Routing',
    'territoryId': 't3',
    'territoryName': 'EMEA DACH Enterprise',
    'conditions': [
      {
        'field': 'country',
        'operator': 'in',
        'value': 'Germany, Austria, Switzerland'
      },
      {'field': 'employees', 'operator': 'gt', 'value': '500'},
    ],
    'priority': 2,
    'active': true,
  },
  {
    'id': 'r3',
    'name': 'SMB Auto-Route',
    'territoryId': 't5',
    'territoryName': 'UK & Ireland SMB',
    'conditions': [
      {'field': 'country', 'operator': 'in', 'value': 'UK, Ireland'},
      {'field': 'employees', 'operator': 'lt', 'value': '200'},
      {'field': 'revenue', 'operator': 'between', 'value': '\$1M - \$20M'},
    ],
    'priority': 3,
    'active': true,
  },
  {
    'id': 'r4',
    'name': 'APAC Growth Accounts',
    'territoryId': 't4',
    'territoryName': 'APAC Growth',
    'conditions': [
      {
        'field': 'country',
        'operator': 'in',
        'value': 'Singapore, Indonesia, Thailand, Vietnam'
      },
      {
        'field': 'industry',
        'operator': 'in',
        'value': 'Technology, Fintech, E-commerce'
      },
    ],
    'priority': 4,
    'active': true,
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

String _formatCurrency(double value) {
  if (value >= 1000000) {
    return '\$${(value / 1000000).toStringAsFixed(1)}M';
  } else if (value >= 1000) {
    return '\$${(value / 1000).toStringAsFixed(0)}K';
  }
  return '\$${value.toStringAsFixed(0)}';
}

Color _attainmentColor(double pct) {
  if (pct >= 80) return Colors.green;
  if (pct >= 50) return Colors.orange;
  return Colors.red;
}

String _conditionLabel(Map<String, String> c) {
  const fieldLabels = {
    'country': 'Country',
    'industry': 'Industry',
    'employees': 'Employees',
    'revenue': 'Revenue',
  };
  const opLabels = {
    'equals': '=',
    'in': 'in',
    'gt': '>',
    'lt': '<',
    'between': 'between',
  };
  final field = fieldLabels[c['field']] ?? c['field'] ?? '';
  final op = opLabels[c['operator']] ?? c['operator'] ?? '';
  final value = c['value'] ?? '';
  return '$field $op $value';
}

List<_HierarchyNode> _buildHierarchy(List<Territory> territories) {
  final regionMap = <String, Map<String, List<Territory>>>{};
  for (final t in territories) {
    regionMap.putIfAbsent(t.region, () => {});
    regionMap[t.region]!.putIfAbsent(t.subRegion, () => []);
    regionMap[t.region]![t.subRegion]!.add(t);
  }
  return regionMap.entries
      .map((e) => _HierarchyNode(
            region: e.key,
            subRegions: e.value.entries
                .map((sr) =>
                    _SubRegionNode(name: sr.key, territories: sr.value))
                .toList(),
          ))
      .toList();
}

// ── Screen ───────────────────────────────────────────────────────────────────

class TerritoriesScreen extends ConsumerStatefulWidget {
  const TerritoriesScreen({super.key});

  @override
  ConsumerState<TerritoriesScreen> createState() => _TerritoriesScreenState();
}

class _TerritoriesScreenState extends ConsumerState<TerritoriesScreen> {
  List<Territory> _territories = [];
  List<AssignmentRule> _rules = [];
  bool _loading = true;
  String? _error;
  String _searchQuery = '';
  String _selectedFilter = 'All';
  ViewMode _viewMode = ViewMode.list;
  final Set<String> _expandedRegions = {};
  bool _rulesExpanded = false;

  final TextEditingController _searchController = TextEditingController();

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
      final results = await Future.wait([
        ApiClient.instance.dio
            .get('${Endpoints.apiUrl}/api/v1/territories')
            .catchError((_) => null),
        ApiClient.instance.dio
            .get('${Endpoints.apiUrl}/api/v1/territories/rules')
            .catchError((_) => null),
      ]);

      final terrRes = results[0];
      final rulesRes = results[1];

      if (mounted) {
        if (terrRes != null && terrRes.data != null) {
          final data = terrRes.data['data'];
          final items = data is List
              ? data
              : (data is Map
                  ? (data['items'] ?? data['territories'] ?? [])
                  : []);
          if ((items as List).isNotEmpty) {
            _territories = items
                .map((e) =>
                    Territory.fromJson(Map<String, dynamic>.from(e)))
                .toList();
          } else {
            _territories = _demoParsedTerritories();
          }
        } else {
          _territories = _demoParsedTerritories();
        }

        if (rulesRes != null && rulesRes.data != null) {
          final data = rulesRes.data['data'];
          final items = data is List
              ? data
              : (data is Map
                  ? (data['items'] ?? data['rules'] ?? [])
                  : []);
          if ((items as List).isNotEmpty) {
            _rules = items
                .map((e) =>
                    AssignmentRule.fromJson(Map<String, dynamic>.from(e)))
                .toList();
          } else {
            _rules = _demoParsedRules();
          }
        } else {
          _rules = _demoParsedRules();
        }

        setState(() {});
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _territories = _demoParsedTerritories();
          _rules = _demoParsedRules();
        });
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Territory> _demoParsedTerritories() =>
      _kDemoTerritories.map((e) => Territory.fromJson(e)).toList();

  List<AssignmentRule> _demoParsedRules() =>
      _kDemoRules.map((e) => AssignmentRule.fromJson(e)).toList();

  List<Territory> get _filteredTerritories {
    var result = _territories;
    final typeFilter = _kFilterTypes[_selectedFilter];
    if (typeFilter != null) {
      result = result.where((t) => t.type == typeFilter).toList();
    }
    if (_searchQuery.isNotEmpty) {
      final q = _searchQuery.toLowerCase();
      result = result.where((t) {
        return t.name.toLowerCase().contains(q) ||
            t.owner.toLowerCase().contains(q) ||
            t.region.toLowerCase().contains(q);
      }).toList();
    }
    return result;
  }

  void _showCreateDialog() {
    final nameCtl = TextEditingController();
    final ownerCtl = TextEditingController();
    final quotaCtl = TextEditingController();
    String selectedType = 'enterprise';
    String selectedRegion = 'North America';
    bool submitting = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(
            20,
            20,
            20,
            MediaQuery.of(ctx).viewInsets.bottom + 20,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Theme.of(ctx)
                        .colorScheme
                        .onSurfaceVariant
                        .withOpacity(0.3),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text('Create Territory',
                  style: Theme.of(ctx)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 16),
              TextField(
                controller: nameCtl,
                decoration: const InputDecoration(
                  labelText: 'Territory Name',
                  hintText: 'e.g. US Northeast Enterprise',
                ),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: selectedRegion,
                decoration: const InputDecoration(labelText: 'Region'),
                items: ['North America', 'EMEA', 'APAC', 'LATAM']
                    .map((r) => DropdownMenuItem(value: r, child: Text(r)))
                    .toList(),
                onChanged: (v) =>
                    setSheetState(() => selectedRegion = v ?? selectedRegion),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: selectedType,
                decoration: const InputDecoration(labelText: 'Type'),
                items: [
                  const DropdownMenuItem(
                      value: 'enterprise', child: Text('Enterprise')),
                  const DropdownMenuItem(
                      value: 'mid-market', child: Text('Mid-Market')),
                  const DropdownMenuItem(value: 'smb', child: Text('SMB')),
                  const DropdownMenuItem(
                      value: 'growth', child: Text('Growth')),
                ],
                onChanged: (v) =>
                    setSheetState(() => selectedType = v ?? selectedType),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: ownerCtl,
                decoration: const InputDecoration(
                  labelText: 'Owner',
                  hintText: 'Assign a territory owner',
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: quotaCtl,
                decoration: const InputDecoration(
                  labelText: 'Quota (\$)',
                  hintText: 'e.g. 5000000',
                ),
                keyboardType: TextInputType.number,
              ),
              const SizedBox(height: 20),
              SizedBox(
                height: 48,
                child: FilledButton(
                  onPressed: submitting
                      ? null
                      : () async {
                          if (nameCtl.text.trim().isEmpty ||
                              ownerCtl.text.trim().isEmpty) return;
                          setSheetState(() => submitting = true);
                          try {
                            await ApiClient.instance.dio.post(
                              '${Endpoints.apiUrl}/api/v1/territories',
                              data: {
                                'name': nameCtl.text.trim(),
                                'region': selectedRegion,
                                'type': selectedType,
                                'owner': ownerCtl.text.trim(),
                                'quota':
                                    double.tryParse(quotaCtl.text.trim()) ?? 0,
                              },
                            );
                          } catch (_) {
                            // fallback: add locally
                          }
                          if (ctx.mounted) {
                            Navigator.pop(ctx);
                            _loadData();
                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                    content: Text('Territory created')),
                              );
                            }
                          }
                        },
                  child: submitting
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white),
                        )
                      : const Text('Create Territory'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final filtered = _filteredTerritories;
    final hierarchy = _buildHierarchy(filtered);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Territories'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadData,
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: SizedBox(
            height: 42,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              children: _kFilterTypes.keys
                  .map(
                    (f) => Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(f),
                        selected: _selectedFilter == f,
                        onSelected: (_) {
                          setState(() => _selectedFilter = f);
                        },
                      ),
                    ),
                  )
                  .toList(),
            ),
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _showCreateDialog,
        child: const Icon(Icons.add),
      ),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadData)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : RefreshIndicator(
                  onRefresh: _loadData,
                  child: CustomScrollView(
                    slivers: [
                      // Search bar
                      SliverToBoxAdapter(
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
                          child: TextField(
                            controller: _searchController,
                            onChanged: (v) =>
                                setState(() => _searchQuery = v),
                            decoration: InputDecoration(
                              hintText: 'Search territories...',
                              prefixIcon:
                                  const Icon(Icons.search, size: 20),
                              suffixIcon: _searchQuery.isNotEmpty
                                  ? IconButton(
                                      icon:
                                          const Icon(Icons.clear, size: 20),
                                      onPressed: () {
                                        _searchController.clear();
                                        setState(() => _searchQuery = '');
                                      },
                                    )
                                  : null,
                              filled: true,
                              fillColor: theme
                                  .colorScheme.surfaceContainerHighest,
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: BorderSide.none,
                              ),
                              contentPadding:
                                  const EdgeInsets.symmetric(vertical: 0),
                            ),
                          ),
                        ),
                      ),

                      // View mode toggle
                      SliverToBoxAdapter(
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
                          child: Row(
                            children: [
                              Expanded(
                                child: SegmentedButton<ViewMode>(
                                  segments: const [
                                    ButtonSegment(
                                      value: ViewMode.list,
                                      label: Text('List'),
                                      icon: Icon(Icons.list, size: 18),
                                    ),
                                    ButtonSegment(
                                      value: ViewMode.hierarchy,
                                      label: Text('Hierarchy'),
                                      icon: Icon(Icons.account_tree_outlined,
                                          size: 18),
                                    ),
                                  ],
                                  selected: {_viewMode},
                                  onSelectionChanged: (s) =>
                                      setState(() => _viewMode = s.first),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),

                      // Summary metrics row
                      SliverToBoxAdapter(
                        child: _buildSummaryRow(filtered, theme),
                      ),

                      // Content based on view mode
                      if (_viewMode == ViewMode.list)
                        ..._buildListView(filtered, theme)
                      else
                        ..._buildHierarchyView(hierarchy, theme),

                      // Assignment rules section
                      SliverToBoxAdapter(
                        child: _buildRulesSection(theme),
                      ),

                      // Bottom padding
                      const SliverToBoxAdapter(
                        child: SizedBox(height: 80),
                      ),
                    ],
                  ),
                ),
    );
  }

  Widget _buildSummaryRow(List<Territory> territories, ThemeData theme) {
    if (territories.isEmpty) return const SizedBox.shrink();

    final totalPipeline =
        territories.fold<double>(0, (s, t) => s + t.pipelineValue);
    final totalRevenue =
        territories.fold<double>(0, (s, t) => s + t.revenue);
    final totalQuota =
        territories.fold<double>(0, (s, t) => s + t.quota);
    final avgWinRate = territories.isNotEmpty
        ? territories.fold<double>(0, (s, t) => s + t.winRate) /
            territories.length
        : 0.0;
    final attainment =
        totalQuota > 0 ? (totalRevenue / totalQuota * 100) : 0.0;

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      child: SizedBox(
        height: 72,
        child: ListView(
          scrollDirection: Axis.horizontal,
          children: [
            _SummaryChip(
              icon: Icons.bar_chart,
              iconColor: Colors.blue,
              label: 'Pipeline',
              value: _formatCurrency(totalPipeline),
            ),
            _SummaryChip(
              icon: Icons.track_changes,
              iconColor: Colors.green,
              label: 'Revenue',
              value: _formatCurrency(totalRevenue),
            ),
            _SummaryChip(
              icon: Icons.flag_outlined,
              iconColor: Colors.amber,
              label: 'Win Rate',
              value: '${avgWinRate.toStringAsFixed(0)}%',
            ),
            _SummaryChip(
              icon: Icons.trending_up,
              iconColor: _attainmentColor(attainment),
              label: 'Attainment',
              value: '${attainment.toStringAsFixed(0)}%',
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _buildListView(
      List<Territory> territories, ThemeData theme) {
    if (territories.isEmpty) {
      return [
        const SliverFillRemaining(
          child: EmptyState(
            icon: Icons.map_outlined,
            title: 'No territories found',
            subtitle: 'Try adjusting your filters or create a new territory',
          ),
        ),
      ];
    }

    return [
      SliverPadding(
        padding: const EdgeInsets.all(12),
        sliver: SliverList(
          delegate: SliverChildBuilderDelegate(
            (context, index) {
              final t = territories[index];
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _TerritoryCard(territory: t),
              );
            },
            childCount: territories.length,
          ),
        ),
      ),
    ];
  }

  List<Widget> _buildHierarchyView(
      List<_HierarchyNode> hierarchy, ThemeData theme) {
    if (hierarchy.isEmpty) {
      return [
        const SliverFillRemaining(
          child: EmptyState(
            icon: Icons.account_tree_outlined,
            title: 'No territories to display',
          ),
        ),
      ];
    }

    return [
      SliverPadding(
        padding: const EdgeInsets.all(12),
        sliver: SliverList(
          delegate: SliverChildBuilderDelegate(
            (context, index) {
              final node = hierarchy[index];
              final isExpanded = _expandedRegions.contains(node.region);
              final totalTerritories = node.subRegions
                  .fold<int>(0, (s, sr) => s + sr.territories.length);
              final totalPipeline = node.subRegions
                  .expand((sr) => sr.territories)
                  .fold<double>(0, (s, t) => s + t.pipelineValue);

              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Card(
                  child: Column(
                    children: [
                      // Region header
                      InkWell(
                        borderRadius: BorderRadius.circular(12),
                        onTap: () {
                          setState(() {
                            if (isExpanded) {
                              _expandedRegions.remove(node.region);
                            } else {
                              _expandedRegions.add(node.region);
                            }
                          });
                        },
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Row(
                            children: [
                              Icon(
                                isExpanded
                                    ? Icons.expand_more
                                    : Icons.chevron_right,
                                size: 20,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                              const SizedBox(width: 8),
                              Icon(Icons.public,
                                  size: 18,
                                  color: theme.colorScheme.primary),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.start,
                                  children: [
                                    Text(node.region,
                                        style: const TextStyle(
                                            fontWeight: FontWeight.w600)),
                                    Text(
                                      '$totalTerritories territories \u00b7 ${_formatCurrency(totalPipeline)} pipeline',
                                      style: theme.textTheme.bodySmall
                                          ?.copyWith(
                                        color: theme
                                            .colorScheme.onSurfaceVariant,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      // Expanded children
                      if (isExpanded)
                        ...node.subRegions.map((sr) => Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Divider(height: 1),
                                Padding(
                                  padding: const EdgeInsets.fromLTRB(
                                      44, 10, 14, 4),
                                  child: Row(
                                    children: [
                                      Icon(Icons.location_on_outlined,
                                          size: 14,
                                          color: theme
                                              .colorScheme.onSurfaceVariant),
                                      const SizedBox(width: 6),
                                      Text(
                                        sr.name,
                                        style: theme.textTheme.bodySmall
                                            ?.copyWith(
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                      const SizedBox(width: 6),
                                      Text(
                                        '(${sr.territories.length})',
                                        style: theme.textTheme.bodySmall
                                            ?.copyWith(
                                          color: theme
                                              .colorScheme.onSurfaceVariant,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                ...sr.territories.map((t) => Padding(
                                      padding: const EdgeInsets.fromLTRB(
                                          44, 4, 14, 4),
                                      child: _HierarchyTerritoryTile(
                                          territory: t),
                                    )),
                              ],
                            )),
                    ],
                  ),
                ),
              );
            },
            childCount: hierarchy.length,
          ),
        ),
      ),
    ];
  }

  Widget _buildRulesSection(ThemeData theme) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 0),
      child: Card(
        child: Column(
          children: [
            InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: () =>
                  setState(() => _rulesExpanded = !_rulesExpanded),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    Icon(
                      _rulesExpanded
                          ? Icons.expand_more
                          : Icons.chevron_right,
                      size: 20,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: 8),
                    Icon(Icons.rule,
                        size: 18, color: theme.colorScheme.primary),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Assignment Rules',
                              style:
                                  TextStyle(fontWeight: FontWeight.w600)),
                          Text(
                            '${_rules.where((r) => r.active).length} active rules',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (_rulesExpanded)
              ..._rules.map((rule) {
                final statusColor =
                    rule.active ? Colors.green : Colors.grey;
                return Column(
                  children: [
                    const Divider(height: 1),
                    Opacity(
                      opacity: rule.active ? 1.0 : 0.6,
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Container(
                                  width: 24,
                                  height: 24,
                                  decoration: BoxDecoration(
                                    color: theme.colorScheme
                                        .surfaceContainerHighest,
                                    shape: BoxShape.circle,
                                  ),
                                  child: Center(
                                    child: Text(
                                      '${rule.priority}',
                                      style: TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.bold,
                                        color: theme.colorScheme
                                            .onSurfaceVariant,
                                      ),
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Text(rule.name,
                                      style: const TextStyle(
                                          fontWeight: FontWeight.w500)),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: statusColor.withOpacity(0.1),
                                    borderRadius:
                                        BorderRadius.circular(4),
                                  ),
                                  child: Text(
                                    rule.active ? 'Active' : 'Inactive',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w600,
                                      color: statusColor,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            Padding(
                              padding:
                                  const EdgeInsets.only(left: 34, top: 4),
                              child: Row(
                                children: [
                                  Icon(Icons.arrow_forward,
                                      size: 12,
                                      color: theme
                                          .colorScheme.onSurfaceVariant),
                                  const SizedBox(width: 4),
                                  Text(
                                    'Routes to: ',
                                    style:
                                        theme.textTheme.bodySmall?.copyWith(
                                      color: theme
                                          .colorScheme.onSurfaceVariant,
                                    ),
                                  ),
                                  Text(
                                    rule.territoryName,
                                    style:
                                        theme.textTheme.bodySmall?.copyWith(
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Padding(
                              padding:
                                  const EdgeInsets.only(left: 34, top: 6),
                              child: Wrap(
                                spacing: 6,
                                runSpacing: 4,
                                children: rule.conditions
                                    .map((c) => Container(
                                          padding:
                                              const EdgeInsets.symmetric(
                                                  horizontal: 8,
                                                  vertical: 3),
                                          decoration: BoxDecoration(
                                            color: theme.colorScheme
                                                .surfaceContainerHighest,
                                            borderRadius:
                                                BorderRadius.circular(4),
                                            border: Border.all(
                                              color: theme.colorScheme
                                                  .outlineVariant,
                                            ),
                                          ),
                                          child: Text(
                                            _conditionLabel(c),
                                            style: const TextStyle(
                                                fontSize: 11),
                                          ),
                                        ))
                                    .toList(),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                );
              }),
          ],
        ),
      ),
    );
  }
}

// ── Sub-Widgets ──────────────────────────────────────────────────────────────

class _SummaryChip extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String label;
  final String value;

  const _SummaryChip({
    required this.icon,
    required this.iconColor,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, size: 14, color: iconColor),
                  const SizedBox(width: 4),
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 11,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                value,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TerritoryCard extends StatelessWidget {
  final Territory territory;

  const _TerritoryCard({required this.territory});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final t = territory;
    final typeColor = _kTypeColors[t.type] ?? Colors.grey;
    final typeLabel = _kTypeLabels[t.type] ?? '';
    final attColor = _attainmentColor(t.attainment);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header row
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(t.name,
                          style: const TextStyle(
                              fontWeight: FontWeight.w600, fontSize: 15)),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          Icon(Icons.location_on_outlined,
                              size: 13,
                              color: theme.colorScheme.onSurfaceVariant),
                          const SizedBox(width: 4),
                          Text(
                            '${t.region} \u00b7 ${t.subRegion}',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: typeColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    typeLabel,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: typeColor,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            // Owner and counts
            Row(
              children: [
                Icon(Icons.person_outline,
                    size: 14, color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: 4),
                Text(t.owner,
                    style: const TextStyle(
                        fontWeight: FontWeight.w500, fontSize: 13)),
                const Spacer(),
                _StatChip(
                    icon: Icons.people_outline,
                    label: '${t.repCount} reps'),
                const SizedBox(width: 10),
                _StatChip(
                    icon: Icons.business_outlined,
                    label: '${t.accountCount} accts'),
              ],
            ),
            const SizedBox(height: 12),
            // Metrics grid
            Row(
              children: [
                Expanded(
                  child: _MetricCell(
                      label: 'Pipeline',
                      value: _formatCurrency(t.pipelineValue)),
                ),
                Expanded(
                  child: _MetricCell(
                      label: 'Revenue',
                      value: _formatCurrency(t.revenue)),
                ),
                Expanded(
                  child: _MetricCell(
                      label: 'Win Rate',
                      value: '${t.winRate.toStringAsFixed(0)}%'),
                ),
                Expanded(
                  child: _MetricCell(
                      label: 'Avg Deal',
                      value: t.accountCount > 0
                          ? _formatCurrency(t.revenue / t.accountCount)
                          : '\$0'),
                ),
              ],
            ),
            const SizedBox(height: 12),
            // Attainment bar
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Quota: ${_formatCurrency(t.quota)}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                Text(
                  '${t.attainment.toStringAsFixed(0)}% attainment',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    color: attColor,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: (t.attainment / 100).clamp(0.0, 1.0),
                backgroundColor: theme.colorScheme.surfaceContainerHighest,
                color: attColor,
                minHeight: 6,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _HierarchyTerritoryTile extends StatelessWidget {
  final Territory territory;

  const _HierarchyTerritoryTile({required this.territory});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final t = territory;
    final typeColor = _kTypeColors[t.type] ?? Colors.grey;
    final typeLabel = _kTypeLabels[t.type] ?? '';
    final attColor = _attainmentColor(t.attainment);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: theme.colorScheme.outlineVariant),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: typeColor.withOpacity(0.1),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              typeLabel,
              style: TextStyle(
                  fontSize: 10, fontWeight: FontWeight.w600, color: typeColor),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(t.name,
                    style: const TextStyle(
                        fontWeight: FontWeight.w500, fontSize: 13)),
                Row(
                  children: [
                    Text(
                      '${t.repCount} reps \u00b7 ${t.accountCount} accts',
                      style: TextStyle(
                        fontSize: 11,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                _formatCurrency(t.pipelineValue),
                style: const TextStyle(
                    fontSize: 12, fontWeight: FontWeight.w600),
              ),
              Text(
                '${t.attainment.toStringAsFixed(0)}%',
                style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: attColor),
              ),
            ],
          ),
        ],
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
        Icon(icon,
            size: 13, color: Theme.of(context).colorScheme.onSurfaceVariant),
        const SizedBox(width: 3),
        Text(
          label,
          style: TextStyle(
            fontSize: 11,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

class _MetricCell extends StatelessWidget {
  final String label;
  final String value;

  const _MetricCell({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 10,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
        ),
      ],
    );
  }
}
