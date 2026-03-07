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
        setState(() => _contacts = List<Map<String, dynamic>>.from(items));
      }
    } catch (e) {
      if (mounted) setState(() => _error = 'Failed to load contacts');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Contacts'),
        actions: [
          IconButton(icon: const Icon(Icons.filter_list), onPressed: () {}),
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
        onPressed: () => context.push('/contacts/new'),
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

                          return ListTile(
                            leading: CircleAvatar(
                              backgroundColor: theme.colorScheme.primaryContainer,
                              child: Text(
                                name.isNotEmpty ? name[0].toUpperCase() : '?',
                                style: TextStyle(color: theme.colorScheme.onPrimaryContainer),
                              ),
                            ),
                            title: Text(name, style: const TextStyle(fontWeight: FontWeight.w500)),
                            subtitle: Text(
                              [title, email].where((s) => s.isNotEmpty).join(' \u00b7 '),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            trailing: const Icon(Icons.chevron_right, size: 20),
                            onTap: () => context.push('/contacts/${c['id']}'),
                          );
                        },
                      ),
                    ),
    );
  }
}
