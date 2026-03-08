import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

class LeadsScreen extends ConsumerStatefulWidget {
  const LeadsScreen({super.key});

  @override
  ConsumerState<LeadsScreen> createState() => _LeadsScreenState();
}

class _LeadsScreenState extends ConsumerState<LeadsScreen> {
  List<Map<String, dynamic>> _leads = [];
  bool _loading = true;
  String? _error;
  final _searchController = TextEditingController();
  String _search = '';
  String _tierFilter = 'all';

  @override
  void initState() {
    super.initState();
    _loadLeads();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  int _hashScore(String id) {
    int h = 0;
    for (final c in id.codeUnits) { h = (h * 31 + c) & 0xffff; }
    return 20 + (h % 61);
  }

  String _scoreTier(int score) {
    if (score >= 70) return 'hot';
    if (score >= 40) return 'warm';
    return 'cold';
  }

  Future<void> _loadLeads() async {
    setState(() { _loading = true; _error = null; });
    try {
      final params = <String, String>{'limit': '50', 'stage': 'lead'};
      if (_search.isNotEmpty) params['search'] = _search;

      final res = await ApiClient.instance.dio.get(Endpoints.leads, queryParameters: params);
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['contacts'] ?? []) : []);
      if (mounted) setState(() => _leads = List<Map<String, dynamic>>.from(items));
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load leads');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _convertToContact(Map<String, dynamic> lead) async {
    try {
      await ApiClient.instance.dio.patch(
        '${Endpoints.contacts}/${lead['id']}',
        data: {'stage': 'contact'},
      );
      _loadLeads();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Converted to contact')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to convert lead')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final filteredLeads = _tierFilter == 'all'
        ? _leads
        : _leads.where((l) {
            final score = l['score'] ?? _hashScore(l['id'] ?? '');
            return _scoreTier(score is int ? score : _hashScore(l['id'] ?? '')) == _tierFilter;
          }).toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Leads'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(96),
          child: Column(
            children: [
              // Search
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: TextField(
                  controller: _searchController,
                  decoration: InputDecoration(
                    hintText: 'Search leads...',
                    prefixIcon: const Icon(Icons.search, size: 20),
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(vertical: 10),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  onSubmitted: (v) {
                    setState(() => _search = v);
                    _loadLeads();
                  },
                ),
              ),
              // Tier filter chips
              SizedBox(
                height: 36,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  children: [
                    _FilterChip(label: 'All', selected: _tierFilter == 'all',
                        onTap: () => setState(() => _tierFilter = 'all')),
                    _FilterChip(label: 'Hot', selected: _tierFilter == 'hot',
                        color: Colors.red,
                        onTap: () => setState(() => _tierFilter = 'hot')),
                    _FilterChip(label: 'Warm', selected: _tierFilter == 'warm',
                        color: Colors.orange,
                        onTap: () => setState(() => _tierFilter = 'warm')),
                    _FilterChip(label: 'Cold', selected: _tierFilter == 'cold',
                        color: Colors.blue,
                        onTap: () => setState(() => _tierFilter = 'cold')),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => context.push('/contacts/new'),
        child: const Icon(Icons.add),
      ),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadLeads)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : filteredLeads.isEmpty
                  ? const EmptyState(icon: Icons.trending_up, title: 'No leads yet')
                  : RefreshIndicator(
                      onRefresh: _loadLeads,
                      child: ListView.separated(
                        itemCount: filteredLeads.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (context, index) {
                          final l = filteredLeads[index];
                          final name = '${l['firstName'] ?? ''} ${l['lastName'] ?? ''}'.trim();
                          final score = l['score'] is int ? l['score'] as int : _hashScore(l['id'] ?? '');
                          final tier = _scoreTier(score);

                          return ListTile(
                            leading: _TierBadge(tier: tier),
                            title: Text(name, style: const TextStyle(fontWeight: FontWeight.w500)),
                            subtitle: Text(
                              [l['title'] ?? '', l['email'] ?? ''].where((s) => s.isNotEmpty).join(' \u00b7 '),
                              maxLines: 1, overflow: TextOverflow.ellipsis,
                            ),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text('$score', style: TextStyle(
                                    fontWeight: FontWeight.bold, fontSize: 13,
                                    color: tier == 'hot' ? Colors.red : tier == 'warm' ? Colors.orange : Colors.blue)),
                                PopupMenuButton<String>(
                                  onSelected: (v) {
                                    if (v == 'convert') _convertToContact(l);
                                    if (v == 'view') context.push('/contacts/${l['id']}');
                                  },
                                  itemBuilder: (_) => [
                                    const PopupMenuItem(value: 'view', child: Text('View details')),
                                    const PopupMenuItem(value: 'convert', child: Text('Convert to contact')),
                                  ],
                                ),
                              ],
                            ),
                            onTap: () => context.push('/contacts/${l['id']}'),
                          );
                        },
                      ),
                    ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final Color? color;
  final VoidCallback onTap;

  const _FilterChip({required this.label, required this.selected, this.color, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        selectedColor: color?.withOpacity(0.2),
        onSelected: (_) => onTap(),
      ),
    );
  }
}

class _TierBadge extends StatelessWidget {
  final String tier;

  const _TierBadge({required this.tier});

  @override
  Widget build(BuildContext context) {
    final config = {
      'hot': (Icons.local_fire_department, Colors.red),
      'warm': (Icons.remove, Colors.orange),
      'cold': (Icons.ac_unit, Colors.blue),
    };
    final (icon, color) = config[tier] ?? (Icons.remove, Colors.grey);
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Icon(icon, size: 20, color: color),
    );
  }
}
