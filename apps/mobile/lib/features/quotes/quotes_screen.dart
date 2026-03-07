import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import 'package:go_router/go_router.dart';
import '../../shared/widgets/error_view.dart';

const _statusColors = <String, Color>{
  'draft': Colors.grey,
  'pending_approval': Color(0xFFD97706),
  'sent': Colors.blue,
  'viewed': Colors.purple,
  'accepted': Colors.green,
  'rejected': Colors.red,
  'expired': Colors.orange,
};

const _statusLabels = <String, String>{
  'draft': 'Draft',
  'pending_approval': 'Pending Approval',
  'sent': 'Sent',
  'viewed': 'Viewed',
  'accepted': 'Accepted',
  'rejected': 'Rejected',
  'expired': 'Expired',
};

const _statusIcons = <String, IconData>{
  'draft': Icons.description_outlined,
  'pending_approval': Icons.schedule,
  'sent': Icons.send_outlined,
  'viewed': Icons.visibility_outlined,
  'accepted': Icons.check_circle_outline,
  'rejected': Icons.thumb_down_outlined,
  'expired': Icons.timer_off_outlined,
};

class QuotesScreen extends ConsumerStatefulWidget {
  const QuotesScreen({super.key});

  @override
  ConsumerState<QuotesScreen> createState() => _QuotesScreenState();
}

class _QuotesScreenState extends ConsumerState<QuotesScreen> {
  List<Map<String, dynamic>> _quotes = [];
  bool _loading = true;
  String? _error;
  String _search = '';
  String _statusFilter = '';
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadQuotes();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadQuotes() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.quotes);
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['quotes'] ?? []) : []);
      if (mounted) setState(() => _quotes = List<Map<String, dynamic>>.from(items));
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load quotes');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> get _filtered {
    return _quotes.where((q) {
      if (_statusFilter.isNotEmpty && q['status'] != _statusFilter) return false;
      if (_search.isNotEmpty) {
        final s = _search.toLowerCase();
        final title = (q['title'] ?? '').toString().toLowerCase();
        final num = (q['quote_number'] ?? q['quoteNumber'] ?? '').toString().toLowerCase();
        final company = (q['company_name'] ?? q['companyName'] ?? '').toString().toLowerCase();
        if (!title.contains(s) && !num.contains(s) && !company.contains(s)) return false;
      }
      return true;
    }).toList();
  }

  double _totalForStatus(List<String> statuses) {
    return _quotes
        .where((q) => statuses.contains(q['status']))
        .fold(0.0, (sum, q) {
      final t = q['total'];
      return sum + (t is num ? t.toDouble() : double.tryParse(t?.toString() ?? '') ?? 0);
    });
  }

  int get _awaitingApproval => _quotes.where((q) => q['status'] == 'pending_approval').length;

  int get _winRate {
    final decided = _quotes.where((q) => q['status'] == 'accepted' || q['status'] == 'rejected').length;
    if (decided == 0) return 0;
    final won = _quotes.where((q) => q['status'] == 'accepted').length;
    return (won / decided * 100).round();
  }

  String _fmtCurrency(double v) {
    if (v >= 1000000) return '\$${(v / 1000000).toStringAsFixed(1)}M';
    if (v >= 1000) return '\$${(v / 1000).toStringAsFixed(1)}K';
    return '\$${v.toStringAsFixed(0)}';
  }

  Future<void> _sendQuote(String id) async {
    try {
      await ApiClient.instance.dio.post('${Endpoints.quotes}/$id/send');
      _loadQuotes();
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to send')));
    }
  }

  Future<void> _approveQuote(String id) async {
    try {
      await ApiClient.instance.dio.post('${Endpoints.quotes}/$id/approve');
      _loadQuotes();
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to approve')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final filtered = _filtered;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            const Text('Quotes'),
            if (_quotes.isNotEmpty) ...[
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(12)),
                child: Text('${_quotes.length}', style: theme.textTheme.bodySmall),
              ),
            ],
          ],
        ),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadQuotes),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () async {
          final created = await context.push<bool>('/quotes/new');
          if (created == true) _loadQuotes();
        },
        child: const Icon(Icons.add),
      ),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadQuotes)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : _quotes.isEmpty
                  ? const EmptyState(icon: Icons.request_quote, title: 'No quotes yet')
                  : RefreshIndicator(
                      onRefresh: _loadQuotes,
                      child: ListView(
                        padding: const EdgeInsets.all(12),
                        children: [
                          // KPI cards
                          Row(
                            children: [
                              Expanded(child: _KpiCard(
                                label: 'Won',
                                value: _fmtCurrency(_totalForStatus(['accepted'])),
                                icon: Icons.check_circle_outline,
                                color: Colors.green,
                              )),
                              const SizedBox(width: 8),
                              Expanded(child: _KpiCard(
                                label: 'In Pipeline',
                                value: _fmtCurrency(_totalForStatus(['sent', 'viewed'])),
                                icon: Icons.trending_up,
                                color: Colors.blue,
                              )),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Expanded(child: _KpiCard(
                                label: 'Win Rate',
                                value: '$_winRate%',
                                icon: Icons.attach_money,
                                color: Colors.purple,
                              )),
                              const SizedBox(width: 8),
                              Expanded(child: _KpiCard(
                                label: 'Awaiting Approval',
                                value: '$_awaitingApproval',
                                icon: Icons.schedule,
                                color: const Color(0xFFD97706),
                              )),
                            ],
                          ),
                          const SizedBox(height: 12),

                          // Search
                          TextField(
                            controller: _searchController,
                            decoration: InputDecoration(
                              hintText: 'Search quotes, companies...',
                              prefixIcon: const Icon(Icons.search, size: 20),
                              isDense: true,
                              contentPadding: const EdgeInsets.symmetric(vertical: 10),
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                              suffixIcon: _search.isNotEmpty
                                  ? IconButton(icon: const Icon(Icons.clear, size: 18), onPressed: () {
                                      _searchController.clear();
                                      setState(() => _search = '');
                                    })
                                  : null,
                            ),
                            onChanged: (v) => setState(() => _search = v),
                          ),
                          const SizedBox(height: 8),

                          // Status filter chips
                          SizedBox(
                            height: 36,
                            child: ListView(
                              scrollDirection: Axis.horizontal,
                              children: [
                                _buildFilterChip('All', _statusFilter.isEmpty, () => setState(() => _statusFilter = '')),
                                ..._statusLabels.entries.map((e) => _buildFilterChip(
                                  e.value, _statusFilter == e.key, () => setState(() => _statusFilter = e.key),
                                )),
                              ],
                            ),
                          ),
                          const SizedBox(height: 8),

                          // Approval alert
                          if (_awaitingApproval > 0 && _statusFilter != 'pending_approval')
                            Container(
                              margin: const EdgeInsets.only(bottom: 8),
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                              decoration: BoxDecoration(
                                color: Colors.amber.shade50,
                                border: Border.all(color: Colors.amber.shade200),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Row(
                                children: [
                                  Icon(Icons.schedule, size: 16, color: Colors.amber.shade800),
                                  const SizedBox(width: 8),
                                  Expanded(child: Text(
                                    '$_awaitingApproval quote${_awaitingApproval != 1 ? 's' : ''} pending approval',
                                    style: TextStyle(fontSize: 13, color: Colors.amber.shade900),
                                  )),
                                  GestureDetector(
                                    onTap: () => setState(() => _statusFilter = 'pending_approval'),
                                    child: Text('View all', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Colors.amber.shade800)),
                                  ),
                                ],
                              ),
                            ),

                          // Quote list
                          if (filtered.isEmpty)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 32),
                              child: Center(child: Text('No quotes match your filters',
                                  style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant))),
                            )
                          else
                            ...filtered.map((q) => _buildQuoteCard(q, theme)),
                        ],
                      ),
                    ),
    );
  }

  Widget _buildFilterChip(String label, bool selected, VoidCallback onTap) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: selected ? theme.colorScheme.primary : theme.colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Text(label, style: TextStyle(
            fontSize: 12, fontWeight: FontWeight.w500,
            color: selected ? theme.colorScheme.onPrimary : theme.colorScheme.onSurfaceVariant,
          )),
        ),
      ),
    );
  }

  Widget _buildQuoteCard(Map<String, dynamic> q, ThemeData theme) {
    final status = q['status'] ?? 'draft';
    final color = _statusColors[status] ?? Colors.grey;
    final total = q['total'];
    final currency = q['currency'] ?? 'GBP';
    final itemCount = (q['items'] is List) ? (q['items'] as List).length : 0;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (q['quoteNumber'] != null || q['quote_number'] != null)
                      Text(q['quoteNumber'] ?? q['quote_number'] ?? '',
                          style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                    Text(q['title'] ?? 'Untitled',
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                  ],
                )),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(_statusIcons[status] ?? Icons.description, size: 14, color: color),
                      const SizedBox(width: 4),
                      Text(_statusLabels[status] ?? status,
                          style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w500)),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                if (q['companyName'] != null || q['company_name'] != null)
                  Text(q['companyName'] ?? q['company_name'] ?? '',
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                if (itemCount > 0) ...[
                  Text(' · ', style: theme.textTheme.bodySmall),
                  Text('$itemCount item${itemCount != 1 ? 's' : ''}',
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                ],
                const Spacer(),
                if (total != null)
                  Text('$currency ${_formatTotal(total)}',
                      style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
              ],
            ),
            if (status == 'draft' || status == 'pending_approval') ...[
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton.icon(
                    onPressed: () async {
                      final edited = await context.push<bool>('/quotes/new');
                      if (edited == true) _loadQuotes();
                    },
                    icon: const Icon(Icons.edit, size: 16),
                    label: const Text('Edit', style: TextStyle(fontSize: 12)),
                    style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
                  ),
                  if (status == 'draft')
                    TextButton.icon(
                      onPressed: () => _sendQuote(q['id']),
                      icon: const Icon(Icons.send, size: 16, color: Colors.blue),
                      label: const Text('Send', style: TextStyle(fontSize: 12, color: Colors.blue)),
                      style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
                    ),
                  if (status == 'pending_approval')
                    TextButton.icon(
                      onPressed: () => _approveQuote(q['id']),
                      icon: Icon(Icons.check, size: 16, color: Colors.amber.shade800),
                      label: Text('Approve', style: TextStyle(fontSize: 12, color: Colors.amber.shade800)),
                      style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _formatTotal(dynamic value) {
    final v = value is num ? value.toDouble() : double.tryParse(value.toString()) ?? 0;
    if (v >= 1000) return '${(v / 1000).toStringAsFixed(v % 1000 == 0 ? 0 : 1)}K';
    return v.toStringAsFixed(v == v.roundToDouble() ? 0 : 2);
  }
}

class _KpiCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color color;

  const _KpiCard({required this.label, required this.value, required this.icon, required this.color});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Expanded(child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                const SizedBox(height: 4),
                Text(value, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
              ],
            )),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: color.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
              child: Icon(icon, size: 20, color: color),
            ),
          ],
        ),
      ),
    );
  }
}
