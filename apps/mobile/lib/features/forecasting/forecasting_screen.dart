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
  bool _computing = false;
  String? _error;
  String? _expandedId;
  String? _modelVersion;
  String? _calculatedAt;

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

      // Extract model version and calculatedAt from response metadata or first forecast
      String? modelVer;
      String? calcAt;
      if (forecastRes.data is Map) {
        modelVer = forecastRes.data['modelVersion'] ?? forecastRes.data['model_version'];
        calcAt = forecastRes.data['calculatedAt'] ?? forecastRes.data['calculated_at'];
      }
      if (modelVer == null && items is List && items.isNotEmpty) {
        final first = items.first;
        if (first is Map) {
          modelVer = first['modelVersion'] ?? first['model_version'];
          calcAt = calcAt ?? first['calculatedAt'] ?? first['calculated_at'];
        }
      }

      if (mounted) {
        setState(() {
          _forecasts = List<Map<String, dynamic>>.from(items);
          _summary = sData is Map ? Map<String, dynamic>.from(sData) : {};
          _modelVersion = modelVer;
          _calculatedAt = calcAt;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load forecasts');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _computeForecasts() async {
    setState(() => _computing = true);
    try {
      await ApiClient.instance.dio.post(Endpoints.forecastingCompute);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Forecast computation started')),
        );
        await _loadData();
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to trigger computation')),
        );
      }
    } finally {
      if (mounted) setState(() => _computing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasForecasts = _forecasts.isNotEmpty;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Forecasting'),
        actions: [
          // Compute / Recompute button
          IconButton(
            onPressed: _computing ? null : _computeForecasts,
            tooltip: hasForecasts ? 'Recompute' : 'Compute',
            icon: _computing
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.electric_bolt),
          ),
          // Refresh button
          IconButton(
            onPressed: _loading ? null : _loadData,
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadData)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : RefreshIndicator(
                  onRefresh: _loadData,
                  child: ListView(
                    padding: const EdgeInsets.all(12),
                    children: [
                      // Model version & calculated at bar
                      if (_modelVersion != null || _calculatedAt != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: _MetadataBar(
                            modelVersion: _modelVersion,
                            calculatedAt: _calculatedAt,
                          ),
                        ),

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
        // Bottom row: revenue tiers with colored backgrounds
        Row(
          children: [
            Expanded(
              child: _SummaryTile(
                icon: Icons.trending_up,
                label: 'Likely',
                value: _formatCurrency(likelyRev),
                color: Colors.green,
                filled: true,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _SummaryTile(
                icon: Icons.adjust,
                label: 'Possible',
                value: _formatCurrency(possibleRev),
                color: Colors.amber.shade700,
                filled: true,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _SummaryTile(
                icon: Icons.trending_down,
                label: 'Unlikely',
                value: _formatCurrency(unlikelyRev),
                color: Colors.red,
                filled: true,
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

// ── Metadata bar (model version + calculated at) ────────────────────────────

class _MetadataBar extends StatelessWidget {
  final String? modelVersion;
  final String? calculatedAt;

  const _MetadataBar({this.modelVersion, this.calculatedAt});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withOpacity(0.4),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          if (modelVersion != null) ...[
            Icon(Icons.model_training, size: 14, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(width: 4),
            Text(
              'Model $modelVersion',
              style: TextStyle(
                fontSize: 12,
                color: theme.colorScheme.onSurfaceVariant,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
          if (modelVersion != null && calculatedAt != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Text(
                '\u2022',
                style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
              ),
            ),
          if (calculatedAt != null) ...[
            Icon(Icons.access_time, size: 14, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(width: 4),
            Expanded(
              child: Text(
                'Calculated ${_formatTimestamp(calculatedAt!)}',
                style: TextStyle(
                  fontSize: 12,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _formatTimestamp(String ts) {
    try {
      final dt = DateTime.parse(ts);
      final now = DateTime.now();
      final diff = now.difference(dt);
      if (diff.inMinutes < 1) return 'just now';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      if (diff.inHours < 24) return '${diff.inHours}h ago';
      if (diff.inDays < 7) return '${diff.inDays}d ago';
      return '${dt.month}/${dt.day}/${dt.year}';
    } catch (_) {
      return ts;
    }
  }
}

// ── Summary tile ────────────────────────────────────────────────────────────

class _SummaryTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color color;
  final bool filled;

  const _SummaryTile({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
    this.filled = false,
  });

  @override
  Widget build(BuildContext context) {
    final bgOpacity = filled ? 0.15 : 0.06;
    final borderOpacity = filled ? 0.3 : 0.15;
    final textColor = filled ? color : color;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withOpacity(bgOpacity),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withOpacity(borderOpacity)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 14, color: textColor),
              const SizedBox(width: 4),
              Text(
                label,
                style: TextStyle(fontSize: 11, color: textColor, fontWeight: FontWeight.w500),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: textColor,
            ),
          ),
        ],
      ),
    );
  }
}

// ── Stage badge colors ──────────────────────────────────────────────────────

Color _stageColor(String? stage) {
  switch (stage?.toLowerCase()) {
    case 'lead':
      return Colors.grey;
    case 'qualified':
      return Colors.blue;
    case 'discovery':
      return Colors.indigo;
    case 'proposal':
      return Colors.purple;
    case 'negotiation':
      return Colors.orange;
    case 'closed_won':
      return Colors.green;
    case 'closed_lost':
      return Colors.red;
    default:
      return Colors.grey;
  }
}

String _stageName(String? stage) {
  if (stage == null) return 'Unknown';
  return stage.replaceAll('_', ' ').split(' ').map((w) {
    if (w.isEmpty) return w;
    return '${w[0].toUpperCase()}${w.substring(1)}';
  }).join(' ');
}

// ── Forecast card ───────────────────────────────────────────────────────────

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
    final dealValue = forecast['dealValue'] ?? forecast['deal_value'] ?? forecast['value'] ?? forecast['amount'];
    final dealStage = (forecast['dealStage'] ?? forecast['deal_stage'])?.toString();
    final modelVersion = forecast['modelVersion'] ?? forecast['model_version'];
    final calculatedAt = forecast['calculatedAt'] ?? forecast['calculated_at'];
    final factors = forecast['factors'] is List
        ? List<Map<String, dynamic>>.from(forecast['factors'])
        : <Map<String, dynamic>>[];

    final probColor = probability >= 70
        ? Colors.green
        : probability >= 30
            ? Colors.amber.shade700
            : Colors.red;

    final stageCol = _stageColor(dealStage);

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
                  // Deal name + probability badge
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              dealName,
                              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
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

                  // Deal value (prominent)
                  if (dealValue != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      _formatValue(dealValue),
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w700,
                        color: theme.colorScheme.onSurface,
                      ),
                    ),
                  ],

                  const SizedBox(height: 10),

                  // Stage badge + info chips
                  Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      if (dealStage != null)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: stageCol.withOpacity(0.12),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: stageCol.withOpacity(0.3)),
                          ),
                          child: Text(
                            _stageName(dealStage),
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                              color: stageCol,
                            ),
                          ),
                        ),
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

                  // Per-card model version / calculated-at
                  if (modelVersion != null || calculatedAt != null) ...[
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        if (modelVersion != null)
                          Text(
                            'v$modelVersion',
                            style: TextStyle(
                              fontSize: 10,
                              color: theme.colorScheme.onSurfaceVariant.withOpacity(0.7),
                            ),
                          ),
                        if (modelVersion != null && calculatedAt != null)
                          Text(
                            '  \u2022  ',
                            style: TextStyle(
                              fontSize: 10,
                              color: theme.colorScheme.onSurfaceVariant.withOpacity(0.5),
                            ),
                          ),
                        if (calculatedAt != null)
                          Text(
                            _formatTimestamp(calculatedAt),
                            style: TextStyle(
                              fontSize: 10,
                              color: theme.colorScheme.onSurfaceVariant.withOpacity(0.7),
                            ),
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),

            // Expandable factors section — 2-column grid
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
                    _FactorsGrid(factors: factors),
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

  String _formatTimestamp(dynamic ts) {
    try {
      final dt = DateTime.parse(ts.toString());
      final now = DateTime.now();
      final diff = now.difference(dt);
      if (diff.inMinutes < 1) return 'just now';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      if (diff.inHours < 24) return '${diff.inHours}h ago';
      if (diff.inDays < 7) return '${diff.inDays}d ago';
      return '${dt.month}/${dt.day}/${dt.year}';
    } catch (_) {
      return ts.toString();
    }
  }
}

// ── Info chip ───────────────────────────────────────────────────────────────

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

// ── Factors grid (2-column layout) ──────────────────────────────────────────

class _FactorsGrid extends StatelessWidget {
  final List<Map<String, dynamic>> factors;

  const _FactorsGrid({required this.factors});

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < factors.length; i += 2) {
      rows.add(
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: _FactorTile(factor: factors[i])),
            const SizedBox(width: 8),
            if (i + 1 < factors.length)
              Expanded(child: _FactorTile(factor: factors[i + 1]))
            else
              const Expanded(child: SizedBox.shrink()),
          ],
        ),
      );
      if (i + 2 < factors.length) {
        rows.add(const SizedBox(height: 8));
      }
    }
    return Column(children: rows);
  }
}

// ── Factor tile ─────────────────────────────────────────────────────────────

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
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
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
                    fontSize: 11,
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
                fontSize: 10,
                color: theme.colorScheme.onSurfaceVariant,
              ),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ],
      ),
    );
  }
}
