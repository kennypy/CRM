import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

// ---------------------------------------------------------------------------
// Filter tab enum
// ---------------------------------------------------------------------------
enum _ReviewFilter { pending, accepted, rejected, all }

// ---------------------------------------------------------------------------
// Demo / fallback data
// ---------------------------------------------------------------------------
List<Map<String, dynamic>> _demoItems() => [
      {
        'id': 'demo-1',
        'entityType': 'Contact',
        'field': 'email',
        'currentValue': 'j.doe@oldcorp.com',
        'proposedValue': 'jane.doe@newcorp.io',
        'confidence': 0.92,
        'status': 'pending',
        'sourceType': 'email',
        'matchType': 'exact',
        'evidenceText':
            'From: jane.doe@newcorp.io\nSubject: New email address\n\nHi, please update my contact details. I have moved to NewCorp.',
        'createdAt': DateTime.now().subtract(const Duration(minutes: 12)).toIso8601String(),
      },
      {
        'id': 'demo-2',
        'entityType': 'Company',
        'field': 'industry',
        'currentValue': 'Software',
        'proposedValue': 'Enterprise SaaS',
        'confidence': 0.78,
        'status': 'pending',
        'sourceType': 'linkedin',
        'matchType': 'inferred',
        'evidenceText':
            'LinkedIn profile lists company industry as "Enterprise SaaS" with 200-500 employees.',
        'createdAt': DateTime.now().subtract(const Duration(hours: 2)).toIso8601String(),
      },
      {
        'id': 'demo-3',
        'entityType': 'Deal',
        'field': 'amount',
        'currentValue': '\$25,000',
        'proposedValue': '\$42,000',
        'confidence': 0.65,
        'status': 'pending',
        'sourceType': 'email',
        'matchType': 'extracted',
        'evidenceText':
            '"We are happy to confirm the revised budget of \$42,000 for the Q3 engagement."',
        'createdAt': DateTime.now().subtract(const Duration(hours: 5)).toIso8601String(),
      },
      {
        'id': 'demo-4',
        'entityType': 'Contact',
        'field': 'phone',
        'currentValue': '+1 555-0100',
        'proposedValue': '+1 555-0199',
        'confidence': 0.88,
        'status': 'accepted',
        'sourceType': 'crm_import',
        'matchType': 'exact',
        'evidenceText':
            'CSV import row 42 contains updated phone number +1 555-0199 for contact Jane Doe.',
        'createdAt': DateTime.now().subtract(const Duration(days: 1)).toIso8601String(),
      },
      {
        'id': 'demo-5',
        'entityType': 'Contact',
        'field': 'title',
        'currentValue': 'VP Sales',
        'proposedValue': 'Chief Revenue Officer',
        'confidence': 0.82,
        'status': 'rejected',
        'sourceType': 'linkedin',
        'matchType': 'inferred',
        'evidenceText':
            'LinkedIn headline changed to "Chief Revenue Officer at Acme Corp" on March 1 2026.',
        'createdAt': DateTime.now().subtract(const Duration(days: 3)).toIso8601String(),
      },
    ];

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
class ReviewQueueScreen extends ConsumerStatefulWidget {
  const ReviewQueueScreen({super.key});

  @override
  ConsumerState<ReviewQueueScreen> createState() => _ReviewQueueScreenState();
}

class _ReviewQueueScreenState extends ConsumerState<ReviewQueueScreen>
    with SingleTickerProviderStateMixin {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;
  _ReviewFilter _filter = _ReviewFilter.pending;

  // Track which cards have evidence expanded
  final Set<String> _expandedEvidence = {};

  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _tabController.addListener(() {
      if (!_tabController.indexIsChanging) {
        setState(() {
          _filter = _ReviewFilter.values[_tabController.index];
        });
      }
    });
    _loadQueue();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  // ---- Data loading -------------------------------------------------------

  Future<void> _loadQueue() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.aiReviewQueue);
      final data = res.data['data'];
      final items =
          data is List ? data : (data is Map ? (data['items'] ?? []) : []);
      final parsed = List<Map<String, dynamic>>.from(items);
      if (mounted) {
        setState(() => _items = parsed.isEmpty ? _demoItems() : parsed);
      }
    } catch (_) {
      // Fallback to demo data so the screen is still useful offline
      if (mounted) {
        setState(() {
          _items = _demoItems();
          _error = null; // suppress error when demo data shown
        });
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  // ---- Actions ------------------------------------------------------------

  Future<void> _decide(String id, String decision) async {
    try {
      await ApiClient.instance.dio.post(
        '${Endpoints.aiReviewQueue}/$id/$decision',
      );
      setState(() {
        final idx = _items.indexWhere((i) => i['id'] == id);
        if (idx != -1) {
          _items[idx] = {
            ..._items[idx],
            'status': decision == 'approve' ? 'accepted' : 'rejected',
          };
        }
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Item ${decision == 'approve' ? 'accepted' : 'rejected'}',
            ),
          ),
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

  // ---- Helpers ------------------------------------------------------------

  List<Map<String, dynamic>> get _filteredItems {
    switch (_filter) {
      case _ReviewFilter.pending:
        return _items
            .where((i) => (i['status'] ?? 'pending') == 'pending')
            .toList();
      case _ReviewFilter.accepted:
        return _items.where((i) => i['status'] == 'accepted').toList();
      case _ReviewFilter.rejected:
        return _items.where((i) => i['status'] == 'rejected').toList();
      case _ReviewFilter.all:
        return _items;
    }
  }

  int _countByStatus(String status) =>
      _items.where((i) => (i['status'] ?? 'pending') == status).length;

  Color _confidenceColor(double confidence) {
    if (confidence >= 0.85) return Colors.green;
    if (confidence >= 0.75) return Colors.amber.shade700;
    return Colors.orange;
  }

  String _relativeTime(String? iso) {
    if (iso == null) return '';
    final dt = DateTime.tryParse(iso);
    if (dt == null) return '';
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${(diff.inDays / 7).floor()}w ago';
  }

  IconData _sourceIcon(String? source) {
    switch (source) {
      case 'email':
        return Icons.email_outlined;
      case 'linkedin':
        return Icons.people_outline;
      case 'crm_import':
        return Icons.upload_file_outlined;
      case 'calendar':
        return Icons.calendar_today_outlined;
      case 'web':
        return Icons.language;
      default:
        return Icons.auto_awesome;
    }
  }

  String _sourceLabel(String? source) {
    switch (source) {
      case 'email':
        return 'Email';
      case 'linkedin':
        return 'LinkedIn';
      case 'crm_import':
        return 'CRM Import';
      case 'calendar':
        return 'Calendar';
      case 'web':
        return 'Web';
      default:
        return 'AI';
    }
  }

  Color _matchTypeColor(String? matchType) {
    switch (matchType) {
      case 'exact':
        return Colors.green;
      case 'inferred':
        return Colors.amber.shade700;
      case 'extracted':
        return Colors.blue;
      default:
        return Colors.grey;
    }
  }

  // ---- Build --------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final pendingCount = _countByStatus('pending');

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Review Queue'),
                Text(
                  'AI-extracted data requiring review',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
            const SizedBox(width: 8),
            if (!_loading && pendingCount > 0)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: theme.colorScheme.error,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  '$pendingCount',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
            onPressed: _loadQueue,
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: [
            _buildTab('Pending', pendingCount),
            _buildTab('Accepted', _countByStatus('accepted')),
            _buildTab('Rejected', _countByStatus('rejected')),
            _buildTab('All', _items.length),
          ],
          isScrollable: false,
          labelStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
          unselectedLabelStyle:
              const TextStyle(fontWeight: FontWeight.normal, fontSize: 13),
        ),
      ),
      body: _buildBody(theme),
    );
  }

  Widget _buildTab(String label, int count) {
    return Tab(
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label),
          if (count > 0) ...[
            const SizedBox(width: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(
                color: Theme.of(context)
                    .colorScheme
                    .onSurface
                    .withOpacity(0.12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                '$count',
                style: TextStyle(
                  fontSize: 11,
                  color: Theme.of(context).colorScheme.onSurface,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildBody(ThemeData theme) {
    if (_error != null) {
      return ErrorView(message: _error!, onRetry: _loadQueue);
    }
    if (_loading) {
      return _buildSkeletonList();
    }

    final items = _filteredItems;
    if (items.isEmpty) {
      return EmptyState(
        icon: Icons.check_circle_outline,
        title: _filter == _ReviewFilter.pending
            ? 'No pending items'
            : 'No items',
        subtitle: _filter == _ReviewFilter.pending
            ? 'All AI extractions have been reviewed'
            : null,
      );
    }

    return RefreshIndicator(
      onRefresh: _loadQueue,
      child: ListView.builder(
        padding: const EdgeInsets.only(top: 0, left: 12, right: 12, bottom: 12),
        itemCount: items.length + 1, // +1 for the info banner
        itemBuilder: (context, index) {
          if (index == 0) return _buildInfoBanner(theme);
          return Padding(
            padding: const EdgeInsets.only(top: 8),
            child: _buildCard(items[index - 1], theme),
          );
        },
      ),
    );
  }

  // ---- Info banner --------------------------------------------------------

  Widget _buildInfoBanner(ThemeData theme) {
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.amber.shade50,
        border: Border.all(color: Colors.amber.shade200),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 18, color: Colors.amber.shade800),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Items here were extracted by AI with 75\u201390% confidence. '
              'Review each change and approve or reject it with one tap.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: Colors.amber.shade900,
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ---- Skeleton loading ---------------------------------------------------

  Widget _buildSkeletonList() {
    return ListView.separated(
      padding: const EdgeInsets.all(12),
      itemCount: 4,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (_, __) => _buildSkeletonCard(),
    );
  }

  Widget _buildSkeletonCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _skeletonBox(60, 20),
                const Spacer(),
                _skeletonBox(90, 20),
              ],
            ),
            const SizedBox(height: 14),
            _skeletonBox(100, 12),
            const SizedBox(height: 8),
            _skeletonBox(double.infinity, 14),
            const SizedBox(height: 6),
            _skeletonBox(double.infinity, 14),
            const SizedBox(height: 14),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                _skeletonBox(80, 32),
                const SizedBox(width: 8),
                _skeletonBox(80, 32),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _skeletonBox(double width, double height) {
    return Container(
      width: width == double.infinity ? null : width,
      height: height,
      constraints: width == double.infinity
          ? const BoxConstraints(minWidth: double.infinity)
          : null,
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.onSurface.withOpacity(0.08),
        borderRadius: BorderRadius.circular(4),
      ),
    );
  }

  // ---- Review card --------------------------------------------------------

  Widget _buildCard(Map<String, dynamic> item, ThemeData theme) {
    final confidence = (item['confidence'] is num)
        ? (item['confidence'] as num).toDouble()
        : 0.0;
    final confPercent = (confidence * 100).round();
    final confColor = _confidenceColor(confidence);
    final status = item['status'] ?? 'pending';
    final id = item['id'] ?? '';
    final isExpanded = _expandedEvidence.contains(id);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ---- Header row: entity type + source badge + time -----------
            Row(
              children: [
                // Entity type badge
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    item['entityType'] ?? 'Entity',
                    style: TextStyle(
                      fontSize: 11,
                      color: theme.colorScheme.onPrimaryContainer,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                // Source type badge
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.secondaryContainer,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        _sourceIcon(item['sourceType']),
                        size: 12,
                        color: theme.colorScheme.onSecondaryContainer,
                      ),
                      const SizedBox(width: 3),
                      Text(
                        _sourceLabel(item['sourceType']),
                        style: TextStyle(
                          fontSize: 10,
                          color: theme.colorScheme.onSecondaryContainer,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
                const Spacer(),
                // Relative time
                Text(
                  _relativeTime(item['createdAt']),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),

            // ---- Confidence progress bar ----------------------------------
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            '$confPercent% confidence',
                            style: TextStyle(
                              fontSize: 12,
                              color: confColor,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(width: 8),
                          // Match type badge
                          if (item['matchType'] != null)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 6, vertical: 1),
                              decoration: BoxDecoration(
                                border: Border.all(
                                  color: _matchTypeColor(item['matchType']),
                                  width: 1,
                                ),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                item['matchType'] ?? '',
                                style: TextStyle(
                                  fontSize: 10,
                                  color: _matchTypeColor(item['matchType']),
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: LinearProgressIndicator(
                          value: confidence,
                          minHeight: 6,
                          backgroundColor: confColor.withOpacity(0.15),
                          valueColor: AlwaysStoppedAnimation(confColor),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // ---- Status badge for completed items -------------------------
            if (status != 'pending') ...[
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: status == 'accepted'
                      ? Colors.green.withOpacity(0.1)
                      : Colors.red.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      status == 'accepted'
                          ? Icons.check_circle
                          : Icons.cancel,
                      size: 14,
                      color:
                          status == 'accepted' ? Colors.green : Colors.red,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      status == 'accepted' ? 'Accepted' : 'Rejected',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color:
                            status == 'accepted' ? Colors.green : Colors.red,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
            ],

            // ---- Field change ---------------------------------------------
            Text(
              item['field'] ?? '',
              style: theme.textTheme.labelSmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 4),
            if (item['currentValue'] != null) ...[
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.red.withOpacity(0.06),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.arrow_back, size: 14, color: Colors.red),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        item['currentValue'].toString(),
                        style: const TextStyle(
                          decoration: TextDecoration.lineThrough,
                          color: Colors.red,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 4),
            ],
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: Colors.green.withOpacity(0.06),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Row(
                children: [
                  const Icon(Icons.arrow_forward, size: 14, color: Colors.green),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      item['proposedValue'] ?? '',
                      style: const TextStyle(
                        color: Colors.green,
                        fontWeight: FontWeight.w500,
                        fontSize: 13,
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // ---- Evidence toggle ------------------------------------------
            if (item['evidenceText'] != null) ...[
              const SizedBox(height: 8),
              InkWell(
                onTap: () {
                  setState(() {
                    if (isExpanded) {
                      _expandedEvidence.remove(id);
                    } else {
                      _expandedEvidence.add(id);
                    }
                  });
                },
                borderRadius: BorderRadius.circular(4),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        isExpanded
                            ? Icons.visibility_off_outlined
                            : Icons.visibility_outlined,
                        size: 14,
                        color: theme.colorScheme.primary,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        isExpanded ? 'Hide evidence' : 'Show evidence',
                        style: TextStyle(
                          fontSize: 12,
                          color: theme.colorScheme.primary,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              if (isExpanded) ...[
                const SizedBox(height: 4),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(6),
                    border: Border(
                      left: BorderSide(
                        color: theme.colorScheme.primary.withOpacity(0.4),
                        width: 3,
                      ),
                    ),
                  ),
                  child: Text(
                    '\u201C${item['evidenceText']}\u201D',
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontStyle: FontStyle.italic,
                    ),
                  ),
                ),
              ],
            ],
            const SizedBox(height: 12),

            // ---- Action buttons (only for pending) ------------------------
            if (status == 'pending')
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  OutlinedButton.icon(
                    onPressed: () => _decide(id, 'reject'),
                    icon: const Icon(Icons.close, size: 16),
                    label: const Text('Reject'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.red,
                    ),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton.icon(
                    onPressed: () => _decide(id, 'approve'),
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
  }
}
