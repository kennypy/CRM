import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';

class QuotingSettingsScreen extends ConsumerStatefulWidget {
  const QuotingSettingsScreen({super.key});

  @override
  ConsumerState<QuotingSettingsScreen> createState() => _QuotingSettingsScreenState();
}

class _QuotingSettingsScreenState extends ConsumerState<QuotingSettingsScreen> {
  Map<String, dynamic>? _tenant;
  List<Map<String, dynamic>> _users = [];
  bool _loading = true;
  bool _saving = false;
  bool _dirty = false;

  double _discountThreshold = 20;
  int _quoteValidDays = 30;
  String _sendMethod = 'email';

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    try {
      final results = await Future.wait([
        ApiClient.instance.dio.get(Endpoints.tenant),
        ApiClient.instance.dio.get(Endpoints.users),
      ]);
      if (mounted) {
        _tenant = results[0].data['data'];
        _discountThreshold = (_tenant?['settings']?['discountApprovalThreshold'] ?? 20).toDouble();
        _quoteValidDays = _tenant?['settings']?['quoteValidDays'] ?? 30;
        _sendMethod = _tenant?['settings']?['quoteSendMethod'] ?? 'email';

        final userData = results[1].data['data'];
        final items = userData is List ? userData : (userData is Map ? (userData['items'] ?? userData['users'] ?? []) : []);
        _users = List<Map<String, dynamic>>.from(items);
        setState(() {});
      }
    } catch (_) {}
    finally { if (mounted) setState(() => _loading = false); }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await ApiClient.instance.dio.patch(Endpoints.tenant, data: {
        'settings': {
          'discountApprovalThreshold': _discountThreshold,
          'quoteValidDays': _quoteValidDays,
          'quoteSendMethod': _sendMethod,
        },
      });
      if (mounted) {
        setState(() => _dirty = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Quoting settings saved')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to save settings')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _toggleUserQuoting(Map<String, dynamic> user, bool canQuote) async {
    try {
      await ApiClient.instance.dio.patch('${Endpoints.users}/${user['id']}', data: {
        'canQuote': canQuote,
      });
      _loadData();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to update user')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Quoting'),
        actions: [
          if (_dirty)
            TextButton(
              onPressed: _saving ? null : _save,
              child: _saving
                  ? const SizedBox(height: 16, width: 16,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Save'),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primaryContainer.withOpacity(0.3),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.info_outline, size: 18, color: theme.colorScheme.primary),
                      const SizedBox(width: 8),
                      Expanded(child: Text(
                        'These settings apply to your entire workspace.',
                        style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.primary),
                      )),
                    ],
                  ),
                ),
                const SizedBox(height: 20),

                Text('Approval Rules',
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                const SizedBox(height: 12),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Discount approval threshold',
                            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: Slider(
                                value: _discountThreshold,
                                min: 0,
                                max: 100,
                                divisions: 100,
                                label: '${_discountThreshold.round()}%',
                                onChanged: (v) => setState(() { _discountThreshold = v; _dirty = true; }),
                              ),
                            ),
                            SizedBox(width: 50, child: Text('${_discountThreshold.round()}%',
                                textAlign: TextAlign.right,
                                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold))),
                          ],
                        ),
                        Text('Quotes with discounts above this threshold require manager approval.',
                            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Default quote validity (days)',
                            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                        const SizedBox(height: 8),
                        DropdownButtonFormField<int>(
                          value: _quoteValidDays,
                          items: [7, 14, 30, 45, 60, 90].map((d) =>
                            DropdownMenuItem(value: d, child: Text('$d days'))).toList(),
                          onChanged: (v) => setState(() { _quoteValidDays = v!; _dirty = true; }),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Default send method',
                            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                        const SizedBox(height: 8),
                        SegmentedButton<String>(
                          segments: const [
                            ButtonSegment(value: 'email', label: Text('Email'), icon: Icon(Icons.email, size: 16)),
                            ButtonSegment(value: 'link', label: Text('Link'), icon: Icon(Icons.link, size: 16)),
                            ButtonSegment(value: 'both', label: Text('Both'), icon: Icon(Icons.all_inclusive, size: 16)),
                          ],
                          selected: {_sendMethod},
                          onSelectionChanged: (v) => setState(() { _sendMethod = v.first; _dirty = true; }),
                        ),
                      ],
                    ),
                  ),
                ),

                const SizedBox(height: 24),
                Text('User Permissions',
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                ...(_users.map((u) {
                  final name = '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim();
                  final role = u['role'] ?? 'rep';
                  final isAdminOrManager = role == 'admin' || role == 'manager' || role == 'super_admin';
                  final canQuote = isAdminOrManager || (u['canQuote'] ?? u['can_quote'] ?? false);

                  return SwitchListTile(
                    title: Text(name),
                    subtitle: Text(role.toString().replaceAll('_', ' ')),
                    value: canQuote,
                    onChanged: isAdminOrManager ? null : (v) => _toggleUserQuoting(u, v),
                  );
                })),
              ],
            ),
    );
  }
}
