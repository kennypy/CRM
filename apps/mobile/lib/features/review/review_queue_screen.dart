import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

class ReviewQueueScreen extends ConsumerStatefulWidget {
  const ReviewQueueScreen({super.key});

  @override
  ConsumerState<ReviewQueueScreen> createState() => _ReviewQueueScreenState();
}

class _ReviewQueueScreenState extends ConsumerState<ReviewQueueScreen> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadQueue();
  }

  Future<void> _loadQueue() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.aiReviewQueue);
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? []) : []);
      if (mounted) setState(() => _items = List<Map<String, dynamic>>.from(items));
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load review queue');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _decide(String id, String decision) async {
    try {
      await ApiClient.instance.dio.post(
        '${Endpoints.aiReviewQueue}/$id/$decision',
      );
      setState(() => _items.removeWhere((i) => i['id'] == id));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Item ${decision == 'approve' ? 'approved' : 'rejected'}')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to process item')),
        );
      }
    }
  }

  Color _confidenceColor(double confidence) {
    if (confidence >= 0.85) return Colors.green;
    if (confidence >= 0.7) return Colors.orange;
    return Colors.red;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Review Queue'),
            Text('AI-extracted data requiring review',
                style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant)),
          ],
        ),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadQueue),
        ],
      ),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadQueue)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : _items.isEmpty
                  ? const EmptyState(
                      icon: Icons.check_circle_outline,
                      title: 'Queue is clear',
                    )
                  : RefreshIndicator(
                      onRefresh: _loadQueue,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(12),
                        itemCount: _items.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (context, index) {
                          final item = _items[index];
                          final confidence = (item['confidence'] is num)
                              ? (item['confidence'] as num).toDouble()
                              : 0.0;
                          final confColor = _confidenceColor(confidence);

                          return Card(
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  // Header
                                  Row(
                                    children: [
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: theme.colorScheme.primaryContainer,
                                          borderRadius: BorderRadius.circular(4),
                                        ),
                                        child: Text(
                                          item['entityType'] ?? 'Entity',
                                          style: TextStyle(fontSize: 11,
                                              color: theme.colorScheme.onPrimaryContainer,
                                              fontWeight: FontWeight.w600),
                                        ),
                                      ),
                                      const Spacer(),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: confColor.withOpacity(0.1),
                                          borderRadius: BorderRadius.circular(4),
                                        ),
                                        child: Text(
                                          '${(confidence * 100).round()}% confidence',
                                          style: TextStyle(fontSize: 11,
                                              color: confColor, fontWeight: FontWeight.w600),
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 12),

                                  // Field change
                                  Text(item['field'] ?? '',
                                      style: theme.textTheme.labelSmall?.copyWith(
                                          color: theme.colorScheme.onSurfaceVariant)),
                                  const SizedBox(height: 4),
                                  if (item['currentValue'] != null) ...[
                                    Row(
                                      children: [
                                        const Icon(Icons.arrow_back, size: 14, color: Colors.red),
                                        const SizedBox(width: 4),
                                        Expanded(
                                          child: Text(item['currentValue'].toString(),
                                              style: const TextStyle(
                                                  decoration: TextDecoration.lineThrough,
                                                  color: Colors.red, fontSize: 13)),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 2),
                                  ],
                                  Row(
                                    children: [
                                      const Icon(Icons.arrow_forward, size: 14, color: Colors.green),
                                      const SizedBox(width: 4),
                                      Expanded(
                                        child: Text(item['proposedValue'] ?? '',
                                            style: const TextStyle(
                                                color: Colors.green,
                                                fontWeight: FontWeight.w500, fontSize: 13)),
                                      ),
                                    ],
                                  ),

                                  // Evidence
                                  if (item['evidenceText'] != null) ...[
                                    const SizedBox(height: 12),
                                    Container(
                                      padding: const EdgeInsets.all(10),
                                      decoration: BoxDecoration(
                                        color: theme.colorScheme.surfaceContainerHighest,
                                        borderRadius: BorderRadius.circular(6),
                                      ),
                                      child: Text(
                                        '"${item['evidenceText']}"',
                                        style: theme.textTheme.bodySmall?.copyWith(
                                            fontStyle: FontStyle.italic),
                                        maxLines: 3,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                  ],
                                  const SizedBox(height: 12),

                                  // Actions
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.end,
                                    children: [
                                      OutlinedButton.icon(
                                        onPressed: () => _decide(item['id'], 'reject'),
                                        icon: const Icon(Icons.close, size: 16),
                                        label: const Text('Reject'),
                                        style: OutlinedButton.styleFrom(
                                          foregroundColor: Colors.red,
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      ElevatedButton.icon(
                                        onPressed: () => _decide(item['id'], 'approve'),
                                        icon: const Icon(Icons.check, size: 16),
                                        label: const Text('Approve'),
                                        style: ElevatedButton.styleFrom(
                                          backgroundColor: Colors.green,
                                          foregroundColor: Colors.white,
                                        ),
                                      ),
                                    ],
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
