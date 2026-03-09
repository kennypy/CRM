import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

  int _quoteValidDays = 30;
  String _sendMethod = 'email';

  /// TCV tier-based approval configuration.
  /// Each tier has: label, min, max, maxDiscount (%), approverRole.
  late List<_ApprovalTier> _approvalTiers;

  static const _defaultTiers = [
    _TierDef(label: '< \$10k', min: 0, max: 10000),
    _TierDef(label: '\$10k - \$50k', min: 10000, max: 50000),
    _TierDef(label: '\$50k - \$100k', min: 50000, max: 100000),
    _TierDef(label: '\$100k - \$250k', min: 100000, max: 250000),
    _TierDef(label: '\$250k+', min: 250000, max: -1),
  ];

  @override
  void initState() {
    super.initState();
    _approvalTiers = _defaultTiers
        .map((t) => _ApprovalTier(
              def: t,
              maxDiscountCtl: TextEditingController(text: '20'),
              approverRole: 'manager',
            ))
        .toList();
    _loadData();
  }

  @override
  void dispose() {
    for (final tier in _approvalTiers) {
      tier.maxDiscountCtl.dispose();
    }
    super.dispose();
  }

  Future<void> _loadData() async {
    try {
      final results = await Future.wait([
        ApiClient.instance.dio.get(Endpoints.tenant),
        ApiClient.instance.dio.get(Endpoints.users),
      ]);
      if (mounted) {
        _tenant = results[0].data['data'];
        _quoteValidDays = _tenant?['settings']?['quoteValidDays'] ?? 30;
        _sendMethod = _tenant?['settings']?['quoteSendMethod'] ?? 'email';

        // Load saved approval tiers if available
        final savedTiers = _tenant?['settings']?['approvalTiers'];
        if (savedTiers is List && savedTiers.length == _approvalTiers.length) {
          for (var i = 0; i < savedTiers.length; i++) {
            final t = savedTiers[i];
            _approvalTiers[i].maxDiscountCtl.text =
                (t['maxDiscount'] ?? 20).toString();
            _approvalTiers[i].approverRole =
                t['approverRole'] ?? t['approver_role'] ?? 'manager';
          }
        }

        final userData = results[1].data['data'];
        final items = userData is List
            ? userData
            : (userData is Map ? (userData['items'] ?? userData['users'] ?? []) : []);
        _users = List<Map<String, dynamic>>.from(items);
        setState(() {});
      }
    } catch (_) {}
    finally { if (mounted) setState(() => _loading = false); }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final tiersPayload = List.generate(_approvalTiers.length, (i) {
        final tier = _approvalTiers[i];
        return {
          'label': tier.def.label,
          'min': tier.def.min,
          'max': tier.def.max,
          'maxDiscount': int.tryParse(tier.maxDiscountCtl.text) ?? 20,
          'approverRole': tier.approverRole,
        };
      });

      await ApiClient.instance.dio.patch(Endpoints.tenant, data: {
        'settings': {
          'approvalTiers': tiersPayload,
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

                // ── TCV Tier-Based Approval Table ──
                Text('TCV Approval Tiers',
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                Text('Configure max discount and required approver per deal size tier.',
                    style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant)),
                const SizedBox(height: 12),

                Card(
                  clipBehavior: Clip.antiAlias,
                  child: Column(
                    children: [
                      // Table header
                      Container(
                        color: theme.colorScheme.surfaceVariant.withOpacity(0.5),
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                        child: Row(
                          children: [
                            Expanded(
                              flex: 3,
                              child: Text('TCV Range',
                                  style: theme.textTheme.labelSmall?.copyWith(
                                      fontWeight: FontWeight.w700,
                                      color: theme.colorScheme.onSurfaceVariant)),
                            ),
                            Expanded(
                              flex: 2,
                              child: Text('Max Discount',
                                  style: theme.textTheme.labelSmall?.copyWith(
                                      fontWeight: FontWeight.w700,
                                      color: theme.colorScheme.onSurfaceVariant)),
                            ),
                            Expanded(
                              flex: 3,
                              child: Text('Approver',
                                  style: theme.textTheme.labelSmall?.copyWith(
                                      fontWeight: FontWeight.w700,
                                      color: theme.colorScheme.onSurfaceVariant)),
                            ),
                          ],
                        ),
                      ),
                      const Divider(height: 1),
                      // Tier rows
                      ...List.generate(_approvalTiers.length, (i) {
                        final tier = _approvalTiers[i];
                        final isLast = i == _approvalTiers.length - 1;

                        return Column(
                          children: [
                            Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                              child: Row(
                                children: [
                                  Expanded(
                                    flex: 3,
                                    child: Text(tier.def.label,
                                        style: theme.textTheme.bodyMedium?.copyWith(
                                            fontWeight: FontWeight.w500)),
                                  ),
                                  Expanded(
                                    flex: 2,
                                    child: SizedBox(
                                      height: 40,
                                      child: TextFormField(
                                        controller: tier.maxDiscountCtl,
                                        decoration: const InputDecoration(
                                          suffixText: '%',
                                          contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                                          isDense: true,
                                          border: OutlineInputBorder(),
                                        ),
                                        keyboardType: TextInputType.number,
                                        inputFormatters: [
                                          FilteringTextInputFormatter.digitsOnly,
                                          _MaxValueFormatter(100),
                                        ],
                                        onChanged: (_) {
                                          if (!_dirty) setState(() => _dirty = true);
                                        },
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    flex: 3,
                                    child: SizedBox(
                                      height: 40,
                                      child: DropdownButtonFormField<String>(
                                        value: tier.approverRole,
                                        decoration: const InputDecoration(
                                          contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                                          isDense: true,
                                          border: OutlineInputBorder(),
                                        ),
                                        items: const [
                                          DropdownMenuItem(value: 'manager', child: Text('Manager')),
                                          DropdownMenuItem(value: 'admin', child: Text('Admin')),
                                        ],
                                        onChanged: (v) {
                                          setState(() {
                                            tier.approverRole = v ?? 'manager';
                                            _dirty = true;
                                          });
                                        },
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            if (!isLast) const Divider(height: 1),
                          ],
                        );
                      }),
                    ],
                  ),
                ),

                const SizedBox(height: 20),

                // ── Quote Validity ──
                Text('Quote Defaults',
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
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

/// Immutable definition for a TCV tier range.
class _TierDef {
  final String label;
  final int min;
  final int max; // -1 means unlimited

  const _TierDef({required this.label, required this.min, required this.max});
}

/// Mutable state for a single approval tier row.
class _ApprovalTier {
  final _TierDef def;
  final TextEditingController maxDiscountCtl;
  String approverRole;

  _ApprovalTier({
    required this.def,
    required this.maxDiscountCtl,
    required this.approverRole,
  });
}

/// Input formatter that caps numeric input to a max value.
class _MaxValueFormatter extends TextInputFormatter {
  final int maxValue;
  _MaxValueFormatter(this.maxValue);

  @override
  TextEditingValue formatEditUpdate(
      TextEditingValue oldValue, TextEditingValue newValue) {
    if (newValue.text.isEmpty) return newValue;
    final parsed = int.tryParse(newValue.text);
    if (parsed == null) return oldValue;
    if (parsed > maxValue) {
      return TextEditingValue(
        text: maxValue.toString(),
        selection: TextSelection.collapsed(offset: maxValue.toString().length),
      );
    }
    return newValue;
  }
}
