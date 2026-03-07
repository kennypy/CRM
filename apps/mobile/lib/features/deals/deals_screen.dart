import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

const _stages = ['discovery', 'proposal', 'negotiation', 'closed_won', 'closed_lost'];

const _stageLabels = {
  'lead': 'Lead',
  'qualified': 'Qualified',
  'discovery': 'Discovery',
  'proposal': 'Proposal',
  'negotiation': 'Negotiation',
  'closed_won': 'Won',
  'closed_lost': 'Lost',
};

const _stageColors = {
  'lead': Colors.grey,
  'qualified': Colors.blue,
  'discovery': Colors.indigo,
  'proposal': Colors.orange,
  'negotiation': Colors.deepOrange,
  'closed_won': Colors.green,
  'closed_lost': Colors.red,
};

class DealsScreen extends ConsumerStatefulWidget {
  const DealsScreen({super.key});

  @override
  ConsumerState<DealsScreen> createState() => _DealsScreenState();
}

class _DealsScreenState extends ConsumerState<DealsScreen> with SingleTickerProviderStateMixin {
  List<Map<String, dynamic>> _allDeals = [];
  Map<String, List<Map<String, dynamic>>> _dealsByStage = {};
  bool _loading = true;
  String? _error;
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: _stages.length, vsync: this);
    _loadDeals();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadDeals() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.deals, queryParameters: {'limit': '200'});
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['deals'] ?? []) : []);
      final deals = List<Map<String, dynamic>>.from(items);

      final grouped = <String, List<Map<String, dynamic>>>{};
      for (final stage in _stages) {
        grouped[stage] = deals.where((d) => d['stage'] == stage).toList();
      }

      if (mounted) setState(() {
        _allDeals = deals;
        _dealsByStage = grouped;
      });
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load deals');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _moveDeal(Map<String, dynamic> deal, String direction) async {
    final currentStage = deal['stage'] as String;
    final idx = _stages.indexOf(currentStage);
    final newIdx = direction == 'next' ? idx + 1 : idx - 1;
    if (newIdx < 0 || newIdx >= _stages.length) return;
    final newStage = _stages[newIdx];

    setState(() {
      _dealsByStage[currentStage]?.removeWhere((d) => d['id'] == deal['id']);
      deal['stage'] = newStage;
      _dealsByStage[newStage] ??= [];
      _dealsByStage[newStage]!.add(deal);
    });

    try {
      await ApiClient.instance.dio.patch('${Endpoints.deals}/${deal['id']}', data: {'stage': newStage});
    } catch (_) {
      // Revert on failure
      setState(() {
        _dealsByStage[newStage]?.removeWhere((d) => d['id'] == deal['id']);
        deal['stage'] = currentStage;
        _dealsByStage[currentStage] ??= [];
        _dealsByStage[currentStage]!.add(deal);
      });
    }
  }

  double _getNum(dynamic v) => v is num ? v.toDouble() : double.tryParse(v?.toString() ?? '') ?? 0;

  // Forecast calculations
  double get _openPipelineTotal {
    return _allDeals
        .where((d) => d['stage'] != 'closed_won' && d['stage'] != 'closed_lost')
        .fold(0.0, (s, d) => s + _getNum(d['value']));
  }

  double get _declaredForecast {
    return _allDeals
        .where((d) => d['stage'] != 'closed_won' && d['stage'] != 'closed_lost')
        .fold(0.0, (s, d) => s + _getNum(d['value']) * ((_getNum(d['declaredProbability'] ?? d['declared_probability'])) / 100).clamp(0, 1));
  }

  double get _realityForecast {
    return _allDeals
        .where((d) => d['stage'] != 'closed_won' && d['stage'] != 'closed_lost')
        .fold(0.0, (s, d) => s + _getNum(d['value']) * ((_getNum(d['realityScore'] ?? d['reality_score'] ?? 50)) / 100).clamp(0, 1));
  }

  double get _wonValue {
    return _allDeals
        .where((d) => d['stage'] == 'closed_won')
        .fold(0.0, (s, d) => s + _getNum(d['value']));
  }

  String _fmtCurrency(double v) {
    if (v >= 1000000) return '\$${(v / 1000000).toStringAsFixed(1)}M';
    if (v >= 1000) return '\$${(v / 1000).toStringAsFixed(1)}K';
    return '\$${v.toStringAsFixed(0)}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final gap = _declaredForecast - _realityForecast;
    final gapSignificant = _declaredForecast > 0 && (gap / _declaredForecast * 100) > 15;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            const Text('Opportunities'),
            if (_wonValue > 0) ...[
              const SizedBox(width: 8),
              Text('Won: ${_fmtCurrency(_wonValue)}',
                  style: theme.textTheme.bodySmall?.copyWith(color: Colors.green, fontWeight: FontWeight.w600)),
            ],
          ],
        ),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadDeals),
        ],
        bottom: TabBar(
          controller: _tabController,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          tabs: _stages.map((s) {
            final count = _dealsByStage[s]?.length ?? 0;
            return Tab(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_stageLabels[s] ?? s),
                  if (count > 0) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                      decoration: BoxDecoration(
                        color: (_stageColors[s] ?? Colors.grey).withOpacity(0.15),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text('$count',
                          style: TextStyle(fontSize: 11, color: _stageColors[s], fontWeight: FontWeight.w600)),
                    ),
                  ],
                ],
              ),
            );
          }).toList(),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => context.push('/deals/new'),
        child: const Icon(Icons.add),
      ),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadDeals)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : Column(
                  children: [
                    // Forecast Bar
                    if (_allDeals.isNotEmpty)
                      Container(
                        padding: const EdgeInsets.all(12),
                        child: Row(
                          children: [
                            Expanded(child: _ForecastCard(
                              label: 'Open Pipeline',
                              value: _fmtCurrency(_openPipelineTotal),
                              color: theme.colorScheme.primary,
                            )),
                            const SizedBox(width: 8),
                            Expanded(child: _ForecastCard(
                              label: 'Declared',
                              value: _fmtCurrency(_declaredForecast),
                              color: Colors.blue,
                            )),
                            const SizedBox(width: 8),
                            Expanded(child: _ForecastCard(
                              label: 'Reality',
                              value: _fmtCurrency(_realityForecast),
                              color: gapSignificant ? Colors.red : Colors.green,
                              warning: gapSignificant ? '-${_fmtCurrency(gap)}' : null,
                            )),
                          ],
                        ),
                      ),

                    // Deal tabs
                    Expanded(
                      child: TabBarView(
                        controller: _tabController,
                        children: _stages.map((stage) {
                          final deals = _dealsByStage[stage] ?? [];
                          if (deals.isEmpty) {
                            return EmptyState(icon: Icons.handshake_outlined, title: 'No ${_stageLabels[stage]} deals');
                          }
                          return RefreshIndicator(
                            onRefresh: _loadDeals,
                            child: ListView.separated(
                              padding: const EdgeInsets.all(12),
                              itemCount: deals.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 8),
                              itemBuilder: (context, index) {
                                final d = deals[index];
                                return _DealCard(
                                  deal: d,
                                  stageColor: _stageColors[stage] ?? Colors.grey,
                                  isClosedWon: stage == 'closed_won',
                                  isClosedLost: stage == 'closed_lost',
                                  isFirstStage: stage == _stages.first,
                                  isLastStage: stage == _stages.last,
                                  onTap: () => context.push('/deals/${d['id']}'),
                                  onMovePrev: () => _moveDeal(d, 'prev'),
                                  onMoveNext: () => _moveDeal(d, 'next'),
                                );
                              },
                            ),
                          );
                        }).toList(),
                      ),
                    ),
                  ],
                ),
    );
  }
}

class _ForecastCard extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  final String? warning;

  const _ForecastCard({required this.label, required this.value, required this.color, this.warning});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        border: Border.all(color: warning != null ? Colors.red.shade200 : theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(8),
        color: warning != null ? Colors.red.shade50 : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(label, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant))),
              if (warning != null) Icon(Icons.warning_amber, size: 14, color: Colors.red.shade700),
            ],
          ),
          const SizedBox(height: 2),
          Text(value, style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: color)),
          if (warning != null)
            Text('$warning vs declared', style: TextStyle(fontSize: 10, color: Colors.red.shade700)),
        ],
      ),
    );
  }
}

class _DealCard extends StatelessWidget {
  final Map<String, dynamic> deal;
  final Color stageColor;
  final bool isClosedWon;
  final bool isClosedLost;
  final bool isFirstStage;
  final bool isLastStage;
  final VoidCallback onTap;
  final VoidCallback onMovePrev;
  final VoidCallback onMoveNext;

  const _DealCard({
    required this.deal, required this.stageColor,
    required this.isClosedWon, required this.isClosedLost,
    required this.isFirstStage, required this.isLastStage,
    required this.onTap, required this.onMovePrev, required this.onMoveNext,
  });

  double _getNum(dynamic v) => v is num ? v.toDouble() : double.tryParse(v?.toString() ?? '') ?? 0;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final value = deal['value'];
    final currency = deal['currency'] ?? 'USD';
    final company = deal['company']?['name'] ?? deal['company_name'] ?? deal['companyName'] ?? '';
    final realityScore = _getNum(deal['realityScore'] ?? deal['reality_score']).toInt();
    final declared = _getNum(deal['declaredProbability'] ?? deal['declared_probability']).toInt();
    final closeDate = deal['closeDate'] ?? deal['close_date'];

    Color? scoreBg;
    Color? scoreFg;
    if (realityScore > 0) {
      if (realityScore >= 70) { scoreBg = Colors.green.shade50; scoreFg = Colors.green.shade700; }
      else if (realityScore >= 40) { scoreBg = Colors.amber.shade50; scoreFg = Colors.amber.shade800; }
      else { scoreBg = Colors.red.shade50; scoreFg = Colors.red.shade700; }
    }

    return Card(
      shape: isClosedWon
          ? RoundedRectangleBorder(side: BorderSide(color: Colors.green.shade200), borderRadius: BorderRadius.circular(12))
          : isClosedLost
              ? RoundedRectangleBorder(side: BorderSide(color: Colors.red.shade200), borderRadius: BorderRadius.circular(12))
              : null,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text(deal['name'] ?? 'Untitled',
                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14))),
                  if (realityScore > 0)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(color: scoreBg, borderRadius: BorderRadius.circular(12)),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.trending_up, size: 12, color: scoreFg),
                          const SizedBox(width: 3),
                          Text('$realityScore', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: scoreFg)),
                        ],
                      ),
                    ),
                ],
              ),
              if (company.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(company, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              ],
              const SizedBox(height: 6),
              Row(
                children: [
                  Icon(Icons.attach_money, size: 14, color: stageColor),
                  Text(_formatValue(value, currency),
                      style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: stageColor)),
                  if (closeDate != null) ...[
                    const Spacer(),
                    Text(_formatDate(closeDate), style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                  ],
                ],
              ),

              // Probability row (only for open deals)
              if (!isClosedWon && !isClosedLost && (declared > 0 || realityScore > 0)) ...[
                const SizedBox(height: 6),
                Row(
                  children: [
                    Text('Rep: ${declared > 0 ? '$declared%' : '—'}',
                        style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                    if (realityScore > 0) ...[
                      const SizedBox(width: 12),
                      Text('Reality: $realityScore%',
                          style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                      if (declared > 0) ...[
                        const SizedBox(width: 6),
                        _DeltaBadge(declared: declared, reality: realityScore),
                      ],
                    ],
                  ],
                ),
              ],

              // Move buttons (only for open deals)
              if (!isClosedWon && !isClosedLost) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    if (!isFirstStage)
                      Expanded(child: OutlinedButton.icon(
                        onPressed: onMovePrev,
                        icon: const Icon(Icons.chevron_left, size: 16),
                        label: const Text('Back', style: TextStyle(fontSize: 12)),
                        style: OutlinedButton.styleFrom(visualDensity: VisualDensity.compact),
                      )),
                    if (!isFirstStage && !isLastStage) const SizedBox(width: 8),
                    if (!isLastStage)
                      Expanded(child: OutlinedButton.icon(
                        onPressed: onMoveNext,
                        icon: const Icon(Icons.chevron_right, size: 16),
                        label: const Text('Advance', style: TextStyle(fontSize: 12)),
                        style: OutlinedButton.styleFrom(visualDensity: VisualDensity.compact),
                      )),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  String _formatValue(dynamic value, String currency) {
    final v = value is num ? value.toDouble() : double.tryParse(value?.toString() ?? '') ?? 0;
    if (v >= 1000000) return '$currency ${(v / 1000000).toStringAsFixed(1)}M';
    if (v >= 1000) return '$currency ${(v / 1000).toStringAsFixed(1)}K';
    return '$currency ${v.toStringAsFixed(0)}';
  }

  String _formatDate(String? iso) {
    if (iso == null) return '';
    try {
      final dt = DateTime.parse(iso);
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return '${months[dt.month - 1]} ${dt.day}';
    } catch (_) {
      return '';
    }
  }
}

class _DeltaBadge extends StatelessWidget {
  final int declared;
  final int reality;

  const _DeltaBadge({required this.declared, required this.reality});

  @override
  Widget build(BuildContext context) {
    final delta = reality - declared;
    final label = '${delta > 0 ? '+' : ''}$delta';
    Color color;
    if (delta < -20) {
      color = Colors.red;
    } else if (delta < -10) {
      color = Colors.amber.shade800;
    } else if (delta >= 0) {
      color = Colors.green;
    } else {
      color = Colors.grey;
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (delta < -20) Icon(Icons.warning_amber, size: 12, color: color),
        Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: color)),
      ],
    );
  }
}
