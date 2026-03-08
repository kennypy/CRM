import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/loading_indicator.dart';
import '../../shared/widgets/error_view.dart';

const _stageLabels = {
  'lead': 'Lead',
  'qualified': 'Qualified',
  'discovery': 'Discovery',
  'proposal': 'Proposal',
  'negotiation': 'Negotiation',
  'closed_won': 'Won',
  'closed_lost': 'Lost',
};

const _stageColors = {
  'lead': Colors.grey,
  'qualified': Colors.blue,
  'discovery': Colors.indigo,
  'proposal': Colors.orange,
  'negotiation': Colors.deepOrange,
  'closed_won': Colors.green,
  'closed_lost': Colors.red,
};

class DealDetailScreen extends ConsumerStatefulWidget {
  final String dealId;
  const DealDetailScreen({super.key, required this.dealId});

  @override
  ConsumerState<DealDetailScreen> createState() => _DealDetailScreenState();
}

class _DealDetailScreenState extends ConsumerState<DealDetailScreen> {
  Map<String, dynamic>? _deal;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadDeal();
  }

  Future<void> _loadDeal() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await ApiClient.instance.dio.get('${Endpoints.deals}/${widget.dealId}');
      if (mounted) setState(() => _deal = res.data['data']);
    } catch (e) {
      if (mounted) setState(() => _error = 'Failed to load deal');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _updateStage(String stage) async {
    try {
      await ApiClient.instance.dio.patch(
        '${Endpoints.deals}/${widget.dealId}',
        data: {'stage': stage},
      );
      _loadDeal();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to update stage')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(_deal != null ? (_deal!['name'] ?? 'Deal') : 'Deal'),
      ),
      body: _loading
          ? const LoadingIndicator()
          : _error != null
              ? ErrorView(message: _error!, onRetry: _loadDeal)
              : _deal == null
                  ? const ErrorView(message: 'Deal not found')
                  : RefreshIndicator(
                      onRefresh: _loadDeal,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          // Deal header
                          Text(
                            _deal!['name'] ?? 'Untitled',
                            style: theme.textTheme.headlineSmall
                                ?.copyWith(fontWeight: FontWeight.bold),
                          ),
                          const SizedBox(height: 8),

                          // Stage chip
                          _buildStageChip(theme),
                          const SizedBox(height: 20),

                          // Value card
                          Card(
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('Deal Info',
                                      style: theme.textTheme.titleSmall
                                          ?.copyWith(fontWeight: FontWeight.w600)),
                                  const SizedBox(height: 12),
                                  _InfoRow(label: 'Value', value: _formatValue()),
                                  _InfoRow(label: 'Company',
                                      value: _deal!['company_name'] ?? _deal!['companyName'] ?? '-'),
                                  _InfoRow(label: 'Contact',
                                      value: _deal!['contact_name'] ?? _deal!['contactName'] ?? '-'),
                                  _InfoRow(label: 'Close Date',
                                      value: _deal!['close_date'] ?? _deal!['closeDate'] ?? '-'),
                                  _InfoRow(label: 'Probability',
                                      value: _deal!['probability'] != null
                                          ? '${_deal!['probability']}%'
                                          : '-'),
                                ],
                              ),
                            ),
                          ),
                          const SizedBox(height: 12),

                          // Move stage
                          Card(
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('Move to Stage',
                                      style: theme.textTheme.titleSmall
                                          ?.copyWith(fontWeight: FontWeight.w600)),
                                  const SizedBox(height: 12),
                                  Wrap(
                                    spacing: 8,
                                    runSpacing: 8,
                                    children: _stageLabels.entries.map((e) {
                                      final current = _deal!['stage'] == e.key;
                                      final color = _stageColors[e.key] ?? Colors.grey;
                                      return ChoiceChip(
                                        label: Text(e.value),
                                        selected: current,
                                        selectedColor: color.withOpacity(0.2),
                                        onSelected: current
                                            ? null
                                            : (_) => _updateStage(e.key),
                                      );
                                    }).toList(),
                                  ),
                                ],
                              ),
                            ),
                          ),

                          // Notes
                          if (_deal!['notes'] != null &&
                              (_deal!['notes'] as String).isNotEmpty) ...[
                            const SizedBox(height: 12),
                            Card(
                              child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text('Notes',
                                        style: theme.textTheme.titleSmall
                                            ?.copyWith(fontWeight: FontWeight.w600)),
                                    const SizedBox(height: 8),
                                    Text(_deal!['notes']),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
    );
  }

  Widget _buildStageChip(ThemeData theme) {
    final stage = _deal!['stage'] ?? 'lead';
    final color = _stageColors[stage] ?? Colors.grey;
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        decoration: BoxDecoration(
          color: color.withOpacity(0.15),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(
          _stageLabels[stage] ?? stage,
          style: TextStyle(color: color, fontWeight: FontWeight.w600),
        ),
      ),
    );
  }

  String _formatValue() {
    final value = _deal!['value'];
    final currency = _deal!['currency'] ?? 'USD';
    if (value == null) return '-';
    final v = value is num ? value.toDouble() : double.tryParse(value.toString()) ?? 0;
    return '$currency ${v.toStringAsFixed(2)}';
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
