import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';

class BillingSettingsScreen extends ConsumerStatefulWidget {
  const BillingSettingsScreen({super.key});

  @override
  ConsumerState<BillingSettingsScreen> createState() => _BillingSettingsScreenState();
}

class _BillingSettingsScreenState extends ConsumerState<BillingSettingsScreen> {
  Map<String, dynamic>? _tenant;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadBilling();
  }

  Future<void> _loadBilling() async {
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.tenant);
      if (mounted) setState(() => _tenant = res.data['data']);
    } catch (_) {}
    finally { if (mounted) setState(() => _loading = false); }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final plan = (_tenant?['plan'] ?? 'starter').toString().toUpperCase();
    final planPrices = {'STARTER': '\$0', 'GROWTH': '\$49', 'ENTERPRISE': 'Custom'};

    return Scaffold(
      appBar: AppBar(title: const Text('Billing')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadBilling,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  // Current Plan
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        children: [
                          Icon(Icons.workspace_premium, size: 48,
                              color: plan == 'ENTERPRISE' ? Colors.purple : Colors.blue),
                          const SizedBox(height: 12),
                          Text(plan, style: theme.textTheme.headlineSmall
                              ?.copyWith(fontWeight: FontWeight.bold)),
                          const SizedBox(height: 4),
                          Text('${planPrices[plan] ?? '\$0'}/user/month',
                              style: theme.textTheme.bodyMedium
                                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                          if (plan != 'ENTERPRISE') ...[
                            const SizedBox(height: 16),
                            OutlinedButton(
                              onPressed: () {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(content: Text('Contact sales to upgrade')),
                                );
                              },
                              child: const Text('Upgrade to Enterprise'),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Usage
                  Text('Usage', style: theme.textTheme.titleSmall
                      ?.copyWith(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  _UsageCard(label: 'AI Extractions', used: 0, limit: plan == 'GROWTH' ? 5000 : 1000),
                  const SizedBox(height: 8),
                  _UsageCard(label: 'Contacts', used: 0, limit: plan == 'GROWTH' ? 50000 : 1000),
                  const SizedBox(height: 8),
                  _UsageCard(label: 'Storage', used: 0, limit: plan == 'GROWTH' ? 10 : 1, unit: 'GB'),

                  const SizedBox(height: 24),
                  Card(
                    child: Column(
                      children: [
                        ListTile(
                          leading: const Icon(Icons.credit_card),
                          title: const Text('Payment Method'),
                          subtitle: const Text('Manage via web app'),
                          trailing: const Icon(Icons.open_in_new, size: 18),
                          onTap: () {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Manage payment methods via the web app')),
                            );
                          },
                        ),
                        const Divider(height: 1),
                        ListTile(
                          leading: const Icon(Icons.receipt_long),
                          title: const Text('Invoices'),
                          subtitle: const Text('View billing history'),
                          trailing: const Icon(Icons.open_in_new, size: 18),
                          onTap: () {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('View invoices via the web app')),
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

class _UsageCard extends StatelessWidget {
  final String label;
  final int used;
  final int limit;
  final String unit;

  const _UsageCard({required this.label, required this.used, required this.limit, this.unit = ''});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final pct = limit > 0 ? (used / limit).clamp(0.0, 1.0) : 0.0;
    final color = pct > 0.9 ? Colors.red : pct > 0.7 ? Colors.orange : Colors.green;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(label, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w500)),
                Text('$used / $limit${unit.isNotEmpty ? ' $unit' : ''}',
                    style: theme.textTheme.bodySmall),
              ],
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: pct,
                backgroundColor: theme.colorScheme.surfaceContainerHighest,
                color: color,
                minHeight: 8,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
