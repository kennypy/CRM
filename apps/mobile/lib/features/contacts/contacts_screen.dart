import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

class ContactsScreen extends ConsumerStatefulWidget {
  const ContactsScreen({super.key});

  @override
  ConsumerState<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends ConsumerState<ContactsScreen> {
  List<Map<String, dynamic>> _contacts = [];
  bool _loading = true;
  String? _error;
  final _searchController = TextEditingController();
  String _search = '';
  int _total = 0;

  // Pagination
  int _currentPage = 1;
  static const int _pageSize = 25;
  int get _totalPages => (_total / _pageSize).ceil().clamp(1, 9999);

  // Lifecycle stage filter
  String? _lifecycleFilter; // null means "All"

  static const List<_LifecycleFilterOption> _lifecycleOptions = [
    _LifecycleFilterOption(null, 'All'),
    _LifecycleFilterOption('subscriber', 'Subscriber'),
    _LifecycleFilterOption('lead', 'Lead'),
    _LifecycleFilterOption('mql', 'MQL'),
    _LifecycleFilterOption('sql', 'SQL'),
    _LifecycleFilterOption('opportunity', 'Opportunity'),
    _LifecycleFilterOption('customer', 'Customer'),
  ];

  @override
  void initState() {
    super.initState();
    _loadContacts();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadContacts() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final params = <String, String>{
        'limit': '$_pageSize',
        'page': '$_currentPage',
      };
      if (_search.isNotEmpty) params['search'] = _search;
      if (_lifecycleFilter != null) {
        params['lifecycleStage'] = _lifecycleFilter!;
      }

      final res = await ApiClient.instance.dio
          .get(Endpoints.contacts, queryParameters: params);
      final data = res.data['data'];
      final items = data is List
          ? data
          : (data is Map
              ? (data['items'] ?? data['contacts'] ?? [])
              : []);

      if (mounted) {
        setState(() {
          _contacts = List<Map<String, dynamic>>.from(items);
          if (data is Map && data['total'] != null) {
            _total = data['total'] is int
                ? data['total']
                : int.tryParse(data['total'].toString()) ?? 0;
          } else if (data is List) {
            _total = data.length;
          }
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = 'Failed to load contacts');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _goToPage(int page) {
    if (page < 1 || page > _totalPages || page == _currentPage) return;
    setState(() => _currentPage = page);
    _loadContacts();
  }

  void _onLifecycleFilterChanged(String? value) {
    setState(() {
      _lifecycleFilter = value;
      _currentPage = 1;
    });
    _loadContacts();
  }

  int _influenceScore(Map<String, dynamic> c) {
    final score = c['influenceScore'] ?? c['influence_score'];
    if (score is num) return score.toInt();
    final id = c['id']?.toString() ?? '';
    int h = 0;
    for (final ch in id.codeUnits) {
      h = (h * 31 + ch) & 0xffff;
    }
    return 20 + (h % 61);
  }

  Color _scoreColor(int score) {
    if (score >= 70) return Colors.green;
    if (score >= 40) return Colors.orange;
    return Colors.grey;
  }

  Color _sourceColor(String? source) {
    switch (source?.toLowerCase()) {
      case 'web':
        return Colors.blue;
      case 'import':
        return Colors.purple;
      case 'api':
        return Colors.indigo;
      case 'referral':
        return Colors.green;
      default:
        return Colors.grey;
    }
  }

  Color _lifecycleChipColor(String? stage) {
    switch (stage?.toLowerCase()) {
      case 'subscriber':
        return Colors.grey;
      case 'lead':
        return Colors.blue;
      case 'mql':
        return Colors.indigo;
      case 'sql':
        return Colors.deepPurple;
      case 'opportunity':
        return Colors.orange;
      case 'customer':
        return Colors.green;
      default:
        return Colors.blueGrey;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Contacts'),
            if (_total > 0 && !_loading)
              Text('$_total total',
                  style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant)),
          ],
        ),
        actions: [
          IconButton(
              icon: const Icon(Icons.refresh), onPressed: _loadContacts),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(100),
          child: Column(
            children: [
              // Search bar
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: TextField(
                  controller: _searchController,
                  decoration: InputDecoration(
                    hintText: 'Search contacts...',
                    prefixIcon: const Icon(Icons.search, size: 20),
                    isDense: true,
                    contentPadding:
                        const EdgeInsets.symmetric(vertical: 10),
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8)),
                    suffixIcon: _search.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear, size: 18),
                            onPressed: () {
                              _searchController.clear();
                              setState(() {
                                _search = '';
                                _currentPage = 1;
                              });
                              _loadContacts();
                            },
                          )
                        : null,
                  ),
                  onSubmitted: (v) {
                    setState(() {
                      _search = v;
                      _currentPage = 1;
                    });
                    _loadContacts();
                  },
                ),
              ),
              // Lifecycle stage filter chips
              SizedBox(
                height: 40,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: _lifecycleOptions.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 6),
                  itemBuilder: (context, index) {
                    final option = _lifecycleOptions[index];
                    final isSelected =
                        _lifecycleFilter == option.value;
                    final chipColor =
                        _lifecycleChipColor(option.value);
                    return FilterChip(
                      label: Text(option.label),
                      selected: isSelected,
                      onSelected: (_) =>
                          _onLifecycleFilterChanged(option.value),
                      selectedColor: chipColor.withOpacity(0.2),
                      checkmarkColor: chipColor,
                      labelStyle: TextStyle(
                        fontSize: 12,
                        fontWeight: isSelected
                            ? FontWeight.w600
                            : FontWeight.normal,
                        color: isSelected ? chipColor : null,
                      ),
                      visualDensity: VisualDensity.compact,
                      materialTapTargetSize:
                          MaterialTapTargetSize.shrinkWrap,
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                    );
                  },
                ),
              ),
              const SizedBox(height: 4),
            ],
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () async {
          final created = await context.push<bool>('/contacts/new');
          if (created == true) _loadContacts();
        },
        child: const Icon(Icons.add),
      ),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadContacts)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : _contacts.isEmpty
                  ? const EmptyState(
                      icon: Icons.people_outlined,
                      title: 'No contacts yet')
                  : Column(
                      children: [
                        Expanded(
                          child: RefreshIndicator(
                            onRefresh: _loadContacts,
                            child: ListView.separated(
                              itemCount: _contacts.length,
                              separatorBuilder: (_, __) =>
                                  const Divider(height: 1),
                              itemBuilder: (context, index) {
                                final c = _contacts[index];
                                final name = c['fullName'] ??
                                    '${c['firstName'] ?? ''} ${c['lastName'] ?? ''}'
                                        .trim();
                                final email = c['email'] ?? '';
                                final title = c['title'] ?? '';
                                final score = _influenceScore(c);
                                final scoreColor = _scoreColor(score);
                                final source =
                                    c['source']?.toString();

                                return ListTile(
                                  leading: CircleAvatar(
                                    backgroundColor: theme
                                        .colorScheme.primaryContainer,
                                    child: Text(
                                      name.isNotEmpty
                                          ? name[0].toUpperCase()
                                          : '?',
                                      style: TextStyle(
                                          color: theme.colorScheme
                                              .onPrimaryContainer),
                                    ),
                                  ),
                                  title: Row(
                                    children: [
                                      Expanded(
                                          child: Text(name,
                                              style: const TextStyle(
                                                  fontWeight:
                                                      FontWeight.w500),
                                              overflow: TextOverflow
                                                  .ellipsis)),
                                      if (source != null &&
                                          source.isNotEmpty)
                                        Container(
                                          margin:
                                              const EdgeInsets.only(
                                                  left: 6),
                                          padding: const EdgeInsets
                                              .symmetric(
                                              horizontal: 6,
                                              vertical: 1),
                                          decoration: BoxDecoration(
                                            color: _sourceColor(source)
                                                .withOpacity(0.1),
                                            borderRadius:
                                                BorderRadius.circular(
                                                    4),
                                          ),
                                          child: Text(source,
                                              style: TextStyle(
                                                  fontSize: 10,
                                                  color: _sourceColor(
                                                      source),
                                                  fontWeight:
                                                      FontWeight
                                                          .w500)),
                                        ),
                                    ],
                                  ),
                                  subtitle: Text(
                                    [title, email]
                                        .where((s) => s.isNotEmpty)
                                        .join(' \u00b7 '),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  trailing: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Container(
                                        padding:
                                            const EdgeInsets.symmetric(
                                                horizontal: 6,
                                                vertical: 2),
                                        decoration: BoxDecoration(
                                          color: scoreColor
                                              .withOpacity(0.1),
                                          borderRadius:
                                              BorderRadius.circular(4),
                                        ),
                                        child: Text('$score',
                                            style: TextStyle(
                                                fontSize: 12,
                                                fontWeight:
                                                    FontWeight.bold,
                                                color: scoreColor)),
                                      ),
                                      const SizedBox(width: 4),
                                      const Icon(Icons.chevron_right,
                                          size: 20),
                                    ],
                                  ),
                                  onTap: () => context
                                      .push('/contacts/${c['id']}'),
                                );
                              },
                            ),
                          ),
                        ),
                        // Pagination controls
                        if (_total > _pageSize)
                          _buildPaginationBar(theme),
                      ],
                    ),
    );
  }

  Widget _buildPaginationBar(ThemeData theme) {
    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(
            top: BorderSide(color: theme.colorScheme.outlineVariant)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          IconButton(
            icon: const Icon(Icons.chevron_left),
            onPressed:
                _currentPage > 1 ? () => _goToPage(_currentPage - 1) : null,
            visualDensity: VisualDensity.compact,
            tooltip: 'Previous page',
          ),
          const SizedBox(width: 8),
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: theme.colorScheme.primaryContainer,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Text(
              'Page $_currentPage of $_totalPages',
              style: theme.textTheme.labelMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                  color: theme.colorScheme.onPrimaryContainer),
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            icon: const Icon(Icons.chevron_right),
            onPressed: _currentPage < _totalPages
                ? () => _goToPage(_currentPage + 1)
                : null,
            visualDensity: VisualDensity.compact,
            tooltip: 'Next page',
          ),
        ],
      ),
    );
  }
}

class _LifecycleFilterOption {
  final String? value;
  final String label;
  const _LifecycleFilterOption(this.value, this.label);
}
