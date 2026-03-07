import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

const _statusColors = {
  'draft': Colors.grey,
  'sent': Colors.blue,
  'accepted': Colors.green,
  'rejected': Colors.red,
  'expired': Colors.orange,
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

  @override
  void initState() {
    super.initState();
    _loadQuotes();
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

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Quotes')),
      floatingActionButton: FloatingActionButton(
        onPressed: () {},
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
                      child: ListView.separated(
                        padding: const EdgeInsets.all(12),
                        itemCount: _quotes.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (context, index) {
                          final q = _quotes[index];
                          final status = q['status'] ?? 'draft';
                          final color = _statusColors[status] ?? Colors.grey;

                          return Card(
                            child: ListTile(
                              title: Text(q['title'] ?? q['quote_number'] ?? 'Untitled',
                                  style: const TextStyle(fontWeight: FontWeight.w500)),
                              subtitle: Text(q['company_name'] ?? ''),
                              trailing: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  if (q['total'] != null)
                                    Text('${q['currency'] ?? '\$'}${q['total']}',
                                        style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                                    decoration: BoxDecoration(
                                      color: color.withOpacity(0.1),
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: Text(status,
                                        style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w500)),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
