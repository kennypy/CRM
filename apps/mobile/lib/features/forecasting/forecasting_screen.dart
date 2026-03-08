import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

class ForecastingScreen extends ConsumerStatefulWidget {
  const ForecastingScreen({super.key});

  @override
  ConsumerState<ForecastingScreen> createState() => _ForecastingScreenState();
}

class _ForecastingScreenState extends ConsumerState<ForecastingScreen> {
  List<Map<String, dynamic>> _forecasts = [];
  Map<String, dynamic> _summary = {};
  bool _loading = true;
  String? _error;
  String? _expandedId;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        ApiClient.instance.dio.get(Endpoints.forecasting),
        ApiClient.instance.dio.get('${Endpoints.forecasting}/summary'),
      ]);

      final forecastRes = results[0];
      final summaryRes = results[1];

      final fData = forecastRes.data['data'];
      final items = fData is List
          ? fData
          : (fData is Map ? (fData['items'] ?? fData['forecasts'] ?? []) : []);

      final sData = summaryRes.data['data'];

      if (mounted) {
        setState(() {
          _forecasts = List<Map<String, dynamic>>.from(items);
          _summary = sData is Map ? Map<String, dynamic>.from(sData) : {};
        });
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load forecasts');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Forecasting')),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadData)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : RefreshIndicator(
                  onRefresh: _loadData,
                  child: ListView(
                    padding: const EdgeInsets.all(12),
                    children: [
                      // Summary cards
                      if (_summary.isNotEmpty) ...[
                        _buildSummarySection(theme),
                        const SizedBox(height: 16),
                      ],

                      // Deals list
                      if (_forecasts.isEmpty)
                        const EmptyState(
                          icon: Icons.show_chart,
                          title: 'No forecast data',
                          subtitle: 'AI forecasts will appear here once computed',
                        )
                      else
                        ..._forecasts.map((f) => Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: _ForecastCard(
                            forecast: f,
                            isExpanded: _expandedId == (f['id'] ?? f['dealId']),
                            onToggle: () {
                              final id = f['id'] ?? f['dealId'];
                              setState(() {
                                _expandedId = _expandedId == id ? null : id;
                              });
                            },
                          ),
                        )),
                    ],
                  ),
                ),
    );
  }

  Widget _buildSummarySection(ThemeData theme) {
    final totalDeals = _summary['totalDeals'] ?? _forecasts.length;
    final avgProb = (_summary['avgProbability'] ?? 0).toDouble();
    final likelyRev = (_summary['likelyRevenue'] ?? 0).toDouble();
    final possibleRev = (_summary['possibleRevenue'] ?? 0).toDouble();
    final unlikelyRev = (_summary['unlikelyRevenue'] ?? 0).toDouble();

    return Column(
      children: [
        // Top row: deals count + avg probability
        Row(
          children: [
            Expanded(
              child: _SummaryTile(
                icon: Icons.bar_chart,
                label: 'Total Deals',
                value: '$totalDeals',
                color: theme.colorScheme.primary,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _SummaryTile(
                icon: Icons.analytics_outlined,
                label: 'Avg Probability',
                value: '${avgProb.toStringAsFixed(1)}%',
                color: theme.colorScheme.primary,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        // Bottom row: revenue tiers
        Row(
          children: [
            Expanded(
              child: _SummaryTile(
                icon: Icons.trending_up,
                label: 'Likely',
                value: _formatCurrency(likelyRev),
                color: Colors.green,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _SummaryTile(
                icon: Icons.adjust,
                label: 'Possible',
                value: _formatCurrency(possibleRev),
                color: Colors.amber.shade700,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _SummaryTile(
                icon: Icons.trending_down,
                label: 'Unlikely',
                value: _formatCurrency(unlikelyRev),
                color: Colors.red,
              ),
            ),
          ],
        ),
      ],
    );
  }

  String _formatCurrency(double value) {
    if (value >= 1000000) return '\$${(value / 1000000).toStringAsFixed(1)}M';
    if (value >= 1000) return '\$${(value / 1000).toStringAsFixed(0)}K';
    return '\$${value.toStringAsFixed(0)}';
  }
}

class _SummaryTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color color;

  const _SummaryTile({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withOpacity(0.06),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withOpacity(0.15)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 14, color: color),
              const SizedBox(width: 4),
              Text(
                label,
                style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w500),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

class _ForecastCard extends StatelessWidget {
  final Map<String, dynamic> forecast;
  final bool isExpanded;
  final VoidCallback onToggle;

  const _ForecastCard({
    required this.forecast,
    required this.isExpanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dealName = forecast['dealName'] ?? forecast['deal_name'] ?? 'Unknown Deal';
    final companyName = forecast['companyName'] ?? forecast['company_name'] ?? '';
    final probability = (forecast['predictedCloseProbability'] ?? forecast['predicted_close_probability'] ?? 0).toDouble();
    final ciLow = forecast['confidenceIntervalLow'] ?? forecast['confidence_interval_low'];
    final ciHigh = forecast['confidenceIntervalHigh'] ?? forecast['confidence_interval_high'];
    final predictedDate = forecast['predictedCloseDate'] ?? forecast['predicted_close_date'];
    final predictedValue = forecast['predictedValue'] ?? forecast['predicted_value'];
    final dealStage = forecast['dealStage'] ?? forecast['deal_stage'];
    final factors = forecast['factors'] is List
        ? List<Map<String, dynamic>>.from(forecast['factors'])
        : <Map<String, dynamic>>[];

    final probColor = probability >= 70
        ? Colors.green
        : probability >= 30
            ? Colors.amber.shade700
            : Colors.red;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onToggle,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Deal name + company
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              dealName,
                              style: const TextStyle(fontWeight: FontWeight.w600),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            if (companyName.isNotEmpty)
                              Text(
                                companyName,
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                          ],
                        ),
                      ),
                      // Probability badge
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: probColor.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: probColor.withOpacity(0.3)),
                        ),
                        child: Text(
                          '${probability.toStringAsFixed(0)}%',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                            color: probColor,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),

                  // Probability bar
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: probability / 100,
                      backgroundColor: probColor.withOpacity(0.1),
                      valueColor: AlwaysStoppedAnimation(probColor),
                      minHeight: 6,
                    ),
                  ),
                  const SizedBox(height: 10),

                  // Info row
                  Wrap(
                    spacing: 12,
                    runSpacing: 6,
                    children: [
                      if (ciLow != null && ciHigh != null)
                        _InfoChip(
                          icon: Icons.swap_vert,
                          label: '${ciLow}% - ${ciHigh}%',
                          tooltip: 'Confidence interval',
                        ),
                      if (predictedDate != null)
                        _InfoChip(
                          icon: Icons.calendar_today,
                          label: _formatCloseDate(predictedDate),
                          tooltip: 'Predicted close',
                        ),
                      if (predictedValue != null)
                        _InfoChip(
                          icon: Icons.attach_money,
                          label: _formatValue(predictedValue),
                          tooltip: 'Predicted value',
                        ),
                      if (dealStage != null)
                        _InfoChip(
                          icon: Icons.flag_outlined,
                          label: dealStage.toString().replaceAll('_', ' '),
                          tooltip: 'Stage',
                        ),
                    ],
                  ),
                ],
              ),
            ),

            // Expandable factors section
            if (isExpanded && factors.isNotEmpty)
              Container(
                width: double.infinity,
                color: theme.colorScheme.surfaceContainerHighest.withOpacity(0.3),
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'AI CONTRIBUTING FACTORS',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: theme.colorScheme.onSurfaceVariant,
                        letterSpacing: 0.5,
                      ),
                    ),
                    const SizedBox(height: 8),
                    ...factors.map((f) => _FactorTile(factor: f)),
                  ],
                ),
              ),

            // Expand indicator
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Icon(
                isExpanded ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down,
                size: 18,
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _formatCloseDate(dynamic date) {
    if (date == null) return 'Unknown';
    try {
      final d = DateTime.parse(date.toString());
      return '${d.month}/${d.day}/${d.year}';
    } catch (_) {
      return date.toString();
    }
  }

  String _formatValue(dynamic value) {
    final v = (value is num ? value : double.tryParse(value.toString()) ?? 0).toDouble();
    if (v >= 1000000) return '\$${(v / 1000000).toStringAsFixed(1)}M';
    if (v >= 1000) return '\$${(v / 1000).toStringAsFixed(0)}K';
    return '\$${v.toStringAsFixed(0)}';
  }
}

class _InfoChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final String tooltip;

  const _InfoChip({
    required this.icon,
    required this.label,
    required this.tooltip,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 13, color: theme.colorScheme.onSurfaceVariant),
        const SizedBox(width: 3),
        Text(
          label,
          style: TextStyle(
            fontSize: 12,
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

class _FactorTile extends StatelessWidget {
  final Map<String, dynamic> factor;

  const _FactorTile({required this.factor});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final name = factor['name'] ?? '';
    final impact = (factor['impact'] ?? 0) as num;
    final evidence = factor['evidence'] ?? '';
    final isPositive = impact >= 0;
    final impactColor = isPositive ? Colors.green : Colors.red;

    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: theme.colorScheme.outlineVariant.withOpacity(0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  name,
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: impactColor.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  '${isPositive ? '+' : ''}$impact',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: impactColor,
                  ),
                ),
              ),
            ],
          ),
          if (evidence.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              evidence,
              style: TextStyle(
                fontSize: 11,
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
