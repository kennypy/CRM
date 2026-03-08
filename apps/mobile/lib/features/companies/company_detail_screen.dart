import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/loading_indicator.dart';
import '../../shared/widgets/error_view.dart';

class CompanyDetailScreen extends ConsumerStatefulWidget {
  final String companyId;
  const CompanyDetailScreen({super.key, required this.companyId});

  @override
  ConsumerState<CompanyDetailScreen> createState() => _CompanyDetailScreenState();
}

class _CompanyDetailScreenState extends ConsumerState<CompanyDetailScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  Map<String, dynamic>? _company;
  List<Map<String, dynamic>> _contacts = [];
  List<Map<String, dynamic>> _deals = [];
  List<Map<String, dynamic>> _activities = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _loadAll();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadAll() async {
    setState(() { _loading = true; _error = null; });
    try {
      final results = await Future.wait([
        ApiClient.instance.dio.get('${Endpoints.companies}/${widget.companyId}').catchError((_) => null),
        ApiClient.instance.dio.get(Endpoints.contacts, queryParameters: {'companyId': widget.companyId, 'limit': '50'}).catchError((_) => null),
        ApiClient.instance.dio.get(Endpoints.deals, queryParameters: {'companyId': widget.companyId, 'limit': '50'}).catchError((_) => null),
        ApiClient.instance.dio.get(Endpoints.activities, queryParameters: {'companyId': widget.companyId, 'limit': '20'}).catchError((_) => null),
      ]);

      if (mounted) {
        if (results[0] != null) _company = results[0]!.data['data'];
        if (results[1] != null) {
          final data = results[1]!.data['data'];
          final items = data is List ? data : (data is Map ? (data['items'] ?? data['contacts'] ?? []) : []);
          _contacts = List<Map<String, dynamic>>.from(items);
        }
        if (results[2] != null) {
          final data = results[2]!.data['data'];
          final items = data is List ? data : (data is Map ? (data['items'] ?? data['deals'] ?? []) : []);
          _deals = List<Map<String, dynamic>>.from(items);
        }
        if (results[3] != null) {
          final data = results[3]!.data['data'];
          final items = data is List ? data : (data is Map ? (data['items'] ?? data['activities'] ?? []) : []);
          _activities = List<Map<String, dynamic>>.from(items);
        }
        setState(() {});
      }
    } catch (e) {
      if (mounted) setState(() => _error = 'Failed to load company');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(_company?['name'] ?? 'Company'),
        actions: [
          IconButton(icon: const Icon(Icons.edit_outlined), onPressed: () {
            // Navigate to edit or show bottom sheet
          }),
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadAll),
        ],
        bottom: _loading || _error != null || _company == null ? null : TabBar(
          controller: _tabController,
          tabs: [
            const Tab(text: 'Overview'),
            Tab(text: 'Contacts (${_contacts.length})'),
            Tab(text: 'Deals (${_deals.length})'),
            Tab(text: 'Activity (${_activities.length})'),
          ],
          isScrollable: true,
          tabAlignment: TabAlignment.start,
        ),
      ),
      body: _loading
          ? const LoadingIndicator()
          : _error != null
              ? ErrorView(message: _error!, onRetry: _loadAll)
              : _company == null
                  ? const ErrorView(message: 'Company not found')
                  : TabBarView(
                      controller: _tabController,
                      children: [
                        // Overview tab
                        RefreshIndicator(
                          onRefresh: _loadAll,
                          child: ListView(
                            padding: const EdgeInsets.all(16),
                            children: [
                              Center(
                                child: Column(
                                  children: [
                                    CircleAvatar(
                                      radius: 36,
                                      backgroundColor: theme.colorScheme.secondaryContainer,
                                      child: Text(
                                        (_company!['name'] ?? '?')[0].toUpperCase(),
                                        style: theme.textTheme.headlineMedium?.copyWith(
                                            color: theme.colorScheme.onSecondaryContainer),
                                      ),
                                    ),
                                    const SizedBox(height: 12),
                                    Text(_company!['name'] ?? '',
                                        style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
                                    if (_company!['domain'] != null)
                                      Text(_company!['domain'], style: theme.textTheme.bodySmall
                                          ?.copyWith(color: theme.colorScheme.primary)),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 24),
                              Card(
                                child: Padding(
                                  padding: const EdgeInsets.all(16),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text('Company Info', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                                      const SizedBox(height: 12),
                                      _InfoRow(label: 'Industry', value: _company!['industry'] ?? '-'),
                                      _InfoRow(label: 'Sub-industry', value: _company!['sub_industry'] ?? _company!['subIndustry'] ?? '-'),
                                      _InfoRow(label: 'Segment', value: _company!['segment'] ?? '-'),
                                      _InfoRow(label: 'Revenue', value: _company!['revenue']?.toString() ?? '-'),
                                      _InfoRow(label: 'Employees', value: _company!['employees']?.toString() ?? _company!['size'] ?? '-'),
                                      _InfoRow(label: 'Website', value: _company!['website'] ?? _company!['domain'] ?? '-'),
                                      _InfoRow(label: 'Phone', value: _company!['phone'] ?? '-'),
                                      _InfoRow(label: 'City', value: _company!['city'] ?? '-'),
                                      _InfoRow(label: 'Country', value: _company!['country'] ?? '-'),
                                      _InfoRow(label: 'Region', value: _company!['region'] ?? '-'),
                                    ],
                                  ),
                                ),
                              ),
                              const SizedBox(height: 12),
                              // Quick stats
                              Row(
                                children: [
                                  Expanded(child: Card(
                                    child: Padding(
                                      padding: const EdgeInsets.all(16),
                                      child: Column(
                                        children: [
                                          Text('${_contacts.length}', style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold, color: Colors.blue)),
                                          Text('Contacts', style: theme.textTheme.bodySmall),
                                        ],
                                      ),
                                    ),
                                  )),
                                  Expanded(child: Card(
                                    child: Padding(
                                      padding: const EdgeInsets.all(16),
                                      child: Column(
                                        children: [
                                          Text('${_deals.length}', style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold, color: Colors.green)),
                                          Text('Deals', style: theme.textTheme.bodySmall),
                                        ],
                                      ),
                                    ),
                                  )),
                                  Expanded(child: Card(
                                    child: Padding(
                                      padding: const EdgeInsets.all(16),
                                      child: Column(
                                        children: [
                                          Text('${_activities.length}', style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold, color: Colors.purple)),
                                          Text('Activities', style: theme.textTheme.bodySmall),
                                        ],
                                      ),
                                    ),
                                  )),
                                ],
                              ),
                            ],
                          ),
                        ),

                        // Contacts tab
                        _contacts.isEmpty
                            ? Center(child: Text('No contacts', style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)))
                            : ListView.separated(
                                itemCount: _contacts.length,
                                separatorBuilder: (_, __) => const Divider(height: 1),
                                itemBuilder: (context, index) {
                                  final c = _contacts[index];
                                  final name = '${c['firstName'] ?? ''} ${c['lastName'] ?? ''}'.trim();
                                  return ListTile(
                                    leading: CircleAvatar(
                                      backgroundColor: theme.colorScheme.primaryContainer,
                                      child: Text(name.isNotEmpty ? name[0].toUpperCase() : '?',
                                          style: TextStyle(color: theme.colorScheme.onPrimaryContainer)),
                                    ),
                                    title: Text(name, style: const TextStyle(fontWeight: FontWeight.w500)),
                                    subtitle: Text(c['email'] ?? ''),
                                    trailing: const Icon(Icons.chevron_right, size: 20),
                                    onTap: () => context.push('/contacts/${c['id']}'),
                                  );
                                },
                              ),

                        // Deals tab
                        _deals.isEmpty
                            ? Center(child: Text('No deals', style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)))
                            : ListView.separated(
                                padding: const EdgeInsets.all(12),
                                itemCount: _deals.length,
                                separatorBuilder: (_, __) => const SizedBox(height: 8),
                                itemBuilder: (context, index) {
                                  final d = _deals[index];
                                  final stage = d['stage'] ?? 'lead';
                                  const stageColors = {'lead': Colors.grey, 'qualified': Colors.blue, 'discovery': Colors.indigo,
                                    'proposal': Colors.orange, 'negotiation': Colors.deepOrange, 'closed_won': Colors.green, 'closed_lost': Colors.red};
                                  final color = stageColors[stage] ?? Colors.grey;
                                  return Card(
                                    child: ListTile(
                                      title: Text(d['name'] ?? 'Untitled', style: const TextStyle(fontWeight: FontWeight.w500)),
                                      subtitle: Text(stage.replaceAll('_', ' ')),
                                      trailing: d['value'] != null
                                          ? Text('\$${d['value']}', style: TextStyle(fontWeight: FontWeight.bold, color: color))
                                          : null,
                                      onTap: () => context.push('/deals/${d['id']}'),
                                    ),
                                  );
                                },
                              ),

                        // Activity tab
                        _activities.isEmpty
                            ? Center(child: Text('No activities', style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)))
                            : ListView.separated(
                                padding: const EdgeInsets.all(12),
                                itemCount: _activities.length,
                                separatorBuilder: (_, __) => const SizedBox(height: 4),
                                itemBuilder: (context, index) {
                                  final a = _activities[index];
                                  final type = a['type'] ?? 'note';
                                  const typeIcons = {'email': Icons.email_outlined, 'call': Icons.phone_outlined,
                                    'meeting': Icons.event_outlined, 'note': Icons.note_outlined};
                                  const typeColors = {'email': Colors.blue, 'call': Colors.green, 'meeting': Colors.purple, 'note': Colors.orange};
                                  final color = typeColors[type] ?? Colors.grey;
                                  return Card(
                                    child: ListTile(
                                      dense: true,
                                      leading: Container(
                                        padding: const EdgeInsets.all(6),
                                        decoration: BoxDecoration(color: color.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
                                        child: Icon(typeIcons[type] ?? Icons.timeline, size: 18, color: color),
                                      ),
                                      title: Text(a['notes'] ?? a['subject'] ?? type, maxLines: 1,
                                          overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
                                      subtitle: Text(a['createdAt'] ?? a['created_at'] ?? '', style: const TextStyle(fontSize: 11)),
                                    ),
                                  );
                                },
                              ),
                      ],
                    ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;

  const _InfoRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(label, style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ),
          Expanded(child: Text(value, style: theme.textTheme.bodyMedium)),
        ],
      ),
    );
  }
}
