import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../core/auth/auth_provider.dart';
import '../../shared/widgets/error_view.dart';

class AdminScreen extends ConsumerStatefulWidget {
  const AdminScreen({super.key});

  @override
  ConsumerState<AdminScreen> createState() => _AdminScreenState();
}

class _AdminScreenState extends ConsumerState<AdminScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<Map<String, dynamic>> _reportTypes = [];
  Map<String, dynamic>? _reportResult;
  String? _selectedReport;
  bool _loadingTypes = true;
  bool _runningReport = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadReportTypes();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadReportTypes() async {
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.adminReportTypes);
      if (mounted) {
        setState(() => _reportTypes = List<Map<String, dynamic>>.from(res.data['data'] ?? []));
      }
    } catch (_) {
      // Non-critical
    } finally {
      if (mounted) setState(() => _loadingTypes = false);
    }
  }

  Future<void> _runReport(String reportType) async {
    setState(() { _selectedReport = reportType; _runningReport = true; _reportResult = null; });
    try {
      final res = await ApiClient.instance.dio.post(Endpoints.adminReportRun, data: {'reportType': reportType});
      if (mounted) setState(() => _reportResult = res.data['data']);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to run report')),
        );
      }
    } finally {
      if (mounted) setState(() => _runningReport = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final user = ref.watch(authProvider).user;

    if (user == null || !user.isAdmin) {
      return Scaffold(
        appBar: AppBar(title: const Text('Admin')),
        body: const ErrorView(message: 'Admin access required'),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Admin Panel'),
            Text(
              user.isSuperAdmin ? 'Platform Admin' : 'Workspace Admin',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Reports'),
            Tab(text: 'Overview'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          // Reports tab
          _loadingTypes
              ? const Center(child: CircularProgressIndicator())
              : Column(
                  children: [
                    // Report type picker
                    SizedBox(
                      height: 50,
                      child: ListView(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        children: _reportTypes.map((rt) {
                          final isSelected = _selectedReport == rt['key'];
                          return Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: ChoiceChip(
                              label: Text(rt['label'] ?? ''),
                              selected: isSelected,
                              onSelected: (_) => _runReport(rt['key']),
                            ),
                          );
                        }).toList(),
                      ),
                    ),
                    const Divider(height: 1),

                    // Results
                    Expanded(
                      child: _runningReport
                          ? const Center(child: CircularProgressIndicator())
                          : _reportResult == null
                              ? Center(
                                  child: Text('Select a report to run',
                                      style: theme.textTheme.bodyMedium?.copyWith(
                                          color: theme.colorScheme.onSurfaceVariant)),
                                )
                              : _buildResultTable(),
                    ),
                  ],
                ),

          // Overview tab
          ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Admin Panel',
                          style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                      const SizedBox(height: 8),
                      Text(
                        'Use the Reports tab to run admin reports. '
                        'For full workspace management, use the web admin panel.',
                        style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildResultTable() {
    final columns = List<String>.from(_reportResult!['columns'] ?? []);
    final rows = List<Map<String, dynamic>>.from(_reportResult!['rows'] ?? []);

    if (rows.isEmpty) {
      return const Center(child: Text('No data'));
    }

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: SingleChildScrollView(
        child: DataTable(
          columnSpacing: 20,
          columns: columns.map((c) => DataColumn(
            label: Text(
              c.replaceAllMapped(RegExp(r'([A-Z])'), (m) => ' ${m[1]}')
                  .replaceAll('_', ' ')
                  .trim(),
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12),
            ),
          )).toList(),
          rows: rows.map((row) => DataRow(
            cells: columns.map((c) {
              final val = row[c];
              return DataCell(Text(
                val?.toString() ?? '-',
                style: const TextStyle(fontSize: 13),
              ));
            }).toList(),
          )).toList(),
        ),
      ),
    );
  }
}
