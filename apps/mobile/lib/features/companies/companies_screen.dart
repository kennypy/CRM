import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

class CompaniesScreen extends ConsumerStatefulWidget {
  const CompaniesScreen({super.key});

  @override
  ConsumerState<CompaniesScreen> createState() => _CompaniesScreenState();
}

class _CompaniesScreenState extends ConsumerState<CompaniesScreen> {
  List<Map<String, dynamic>> _companies = [];
  bool _loading = true;
  String? _error;
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadCompanies();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadCompanies() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.companies, queryParameters: {'limit': '50'});
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['companies'] ?? []) : []);
      if (mounted) setState(() => _companies = List<Map<String, dynamic>>.from(items));
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load companies');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Companies'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(56),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Search companies...',
                prefixIcon: const Icon(Icons.search, size: 20),
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 10),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
              ),
              onSubmitted: (_) => _loadCompanies(),
            ),
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => context.push('/companies/new'),
        child: const Icon(Icons.add),
      ),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadCompanies)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : _companies.isEmpty
                  ? const EmptyState(icon: Icons.business, title: 'No companies yet')
                  : RefreshIndicator(
                      onRefresh: _loadCompanies,
                      child: ListView.separated(
                        itemCount: _companies.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (context, index) {
                          final c = _companies[index];
                          return ListTile(
                            leading: CircleAvatar(
                              backgroundColor: theme.colorScheme.secondaryContainer,
                              child: Text(
                                (c['name'] ?? '?')[0].toUpperCase(),
                                style: TextStyle(color: theme.colorScheme.onSecondaryContainer),
                              ),
                            ),
                            title: Text(c['name'] ?? '', style: const TextStyle(fontWeight: FontWeight.w500)),
                            subtitle: Text(
                              [c['industry'], c['country']].where((s) => s != null && s.isNotEmpty).join(' \u00b7 '),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            trailing: const Icon(Icons.chevron_right, size: 20),
                            onTap: () => context.push('/companies/${c['id']}'),
                          );
                        },
                      ),
                    ),
    );
  }
}
