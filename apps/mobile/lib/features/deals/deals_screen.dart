import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

const _stages = ['lead', 'qualified', 'discovery', 'proposal', 'negotiation', 'closed_won', 'closed_lost'];

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

      if (mounted) setState(() => _dealsByStage = grouped);
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load deals');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Pipeline'),
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
              : TabBarView(
                  controller: _tabController,
                  children: _stages.map((stage) {
                    final deals = _dealsByStage[stage] ?? [];
                    if (deals.isEmpty) {
                      return EmptyState(
                        icon: Icons.handshake_outlined,
                        title: 'No ${_stageLabels[stage]} deals',
                      );
                    }
                    return RefreshIndicator(
                      onRefresh: _loadDeals,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(12),
                        itemCount: deals.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (context, index) {
                          final d = deals[index];
                          final value = d['value'];
                          final currency = d['currency'] ?? 'USD';
                          return Card(
                            child: ListTile(
                              title: Text(d['name'] ?? 'Untitled',
                                  style: const TextStyle(fontWeight: FontWeight.w500)),
                              subtitle: Text(d['company_name'] ?? d['companyName'] ?? ''),
                              trailing: value != null
                                  ? Text(
                                      '$currency ${_formatValue(value)}',
                                      style: theme.textTheme.titleSmall?.copyWith(
                                          fontWeight: FontWeight.bold,
                                          color: _stageColors[stage]),
                                    )
                                  : null,
                              onTap: () => context.push('/deals/${d['id']}'),
                            ),
                          );
                        },
                      ),
                    );
                  }).toList(),
                ),
    );
  }

  String _formatValue(dynamic value) {
    final v = value is num ? value.toDouble() : double.tryParse(value.toString()) ?? 0;
    if (v >= 1000000) return '${(v / 1000000).toStringAsFixed(1)}M';
    if (v >= 1000) return '${(v / 1000).toStringAsFixed(1)}K';
    return v.toStringAsFixed(0);
  }
}
