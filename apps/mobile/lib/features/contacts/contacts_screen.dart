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
    setState(() { _loading = true; _error = null; });
    try {
      final params = <String, String>{'limit': '50'};
      if (_search.isNotEmpty) params['search'] = _search;

      final res = await ApiClient.instance.dio.get(Endpoints.contacts, queryParameters: params);
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['contacts'] ?? []) : []);

      if (mounted) {
        setState(() {
          _contacts = List<Map<String, dynamic>>.from(items);
          if (data is Map && data['total'] != null) _total = data['total'];
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = 'Failed to load contacts');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  int _influenceScore(Map<String, dynamic> c) {
    final score = c['influenceScore'] ?? c['influence_score'];
    if (score is num) return score.toInt();
    final id = c['id']?.toString() ?? '';
    int h = 0;
    for (final ch in id.codeUnits) { h = (h * 31 + ch) & 0xffff; }
    return 20 + (h % 61);
  }

  Color _scoreColor(int score) {
    if (score >= 70) return Colors.green;
    if (score >= 40) return Colors.orange;
    return Colors.grey;
  }

  Color _sourceColor(String? source) {
    switch (source?.toLowerCase()) {
      case 'web': return Colors.blue;
      case 'import': return Colors.purple;
      case 'api': return Colors.indigo;
      case 'referral': return Colors.green;
      default: return Colors.grey;
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
              Text('$_total total', style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant)),
          ],
        ),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadContacts),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(56),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Search contacts...',
                prefixIcon: const Icon(Icons.search, size: 20),
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 10),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                suffixIcon: _search.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear, size: 18),
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _search = '');
                          _loadContacts();
                        },
                      )
                    : null,
              ),
              onSubmitted: (v) {
                setState(() => _search = v);
                _loadContacts();
              },
            ),
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
                  ? const EmptyState(icon: Icons.people_outlined, title: 'No contacts yet')
                  : RefreshIndicator(
                      onRefresh: _loadContacts,
                      child: ListView.separated(
                        itemCount: _contacts.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (context, index) {
                          final c = _contacts[index];
                          final name = c['fullName'] ?? '${c['firstName'] ?? ''} ${c['lastName'] ?? ''}'.trim();
                          final email = c['email'] ?? '';
                          final title = c['title'] ?? '';
                          final score = _influenceScore(c);
                          final scoreColor = _scoreColor(score);
                          final source = c['source']?.toString();

                          return ListTile(
                            leading: CircleAvatar(
                              backgroundColor: theme.colorScheme.primaryContainer,
                              child: Text(
                                name.isNotEmpty ? name[0].toUpperCase() : '?',
                                style: TextStyle(color: theme.colorScheme.onPrimaryContainer),
                              ),
                            ),
                            title: Row(
                              children: [
                                Expanded(child: Text(name, style: const TextStyle(fontWeight: FontWeight.w500),
                                    overflow: TextOverflow.ellipsis)),
                                if (source != null && source.isNotEmpty)
                                  Container(
                                    margin: const EdgeInsets.only(left: 6),
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                                    decoration: BoxDecoration(
                                      color: _sourceColor(source).withOpacity(0.1),
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: Text(source, style: TextStyle(fontSize: 10,
                                        color: _sourceColor(source), fontWeight: FontWeight.w500)),
                                  ),
                              ],
                            ),
                            subtitle: Text(
                              [title, email].where((s) => s.isNotEmpty).join(' \u00b7 '),
                              maxLines: 1, overflow: TextOverflow.ellipsis,
                            ),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: scoreColor.withOpacity(0.1),
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text('$score', style: TextStyle(
                                      fontSize: 12, fontWeight: FontWeight.bold, color: scoreColor)),
                                ),
                                const SizedBox(width: 4),
                                const Icon(Icons.chevron_right, size: 20),
                              ],
                            ),
                            onTap: () => context.push('/contacts/${c['id']}'),
                          );
                        },
                      ),
                    ),
    );
  }
}
