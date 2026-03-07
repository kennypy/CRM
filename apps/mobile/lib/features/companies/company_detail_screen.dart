import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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

class _CompanyDetailScreenState extends ConsumerState<CompanyDetailScreen> {
  Map<String, dynamic>? _company;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadCompany();
  }

  Future<void> _loadCompany() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await ApiClient.instance.dio.get('${Endpoints.companies}/${widget.companyId}');
      if (mounted) setState(() => _company = res.data['data']);
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
        title: Text(_company != null ? (_company!['name'] ?? 'Company') : 'Company'),
      ),
      body: _loading
          ? const LoadingIndicator()
          : _error != null
              ? ErrorView(message: _error!, onRetry: _loadCompany)
              : _company == null
                  ? const ErrorView(message: 'Company not found')
                  : RefreshIndicator(
                      onRefresh: _loadCompany,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          // Header
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
                                Text(
                                  _company!['name'] ?? '',
                                  style: theme.textTheme.titleLarge
                                      ?.copyWith(fontWeight: FontWeight.bold),
                                ),
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
                                  Text('Company Info',
                                      style: theme.textTheme.titleSmall
                                          ?.copyWith(fontWeight: FontWeight.w600)),
                                  const SizedBox(height: 12),
                                  _InfoRow(label: 'Industry', value: _company!['industry'] ?? '-'),
                                  _InfoRow(label: 'Website', value: _company!['website'] ?? '-'),
                                  _InfoRow(label: 'Phone', value: _company!['phone'] ?? '-'),
                                  _InfoRow(label: 'Country', value: _company!['country'] ?? '-'),
                                  _InfoRow(label: 'Size', value: _company!['size'] ?? _company!['employeeCount']?.toString() ?? '-'),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
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
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(label,
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ),
          Expanded(child: Text(value, style: theme.textTheme.bodyMedium)),
        ],
      ),
    );
  }
}
