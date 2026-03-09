import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/loading_indicator.dart';
import '../../shared/widgets/error_view.dart';
import '../../shared/widgets/empty_state.dart';

class CampaignsScreen extends ConsumerStatefulWidget {
  const CampaignsScreen({super.key});

  @override
  ConsumerState<CampaignsScreen> createState() => _CampaignsScreenState();
}

class _CampaignsScreenState extends ConsumerState<CampaignsScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  // Campaigns tab state
  List<Map<String, dynamic>> _campaigns = [];
  bool _loading = true;
  String? _error;
  String _statusFilter = 'all';
  String _search = '';

  // Pagination
  int _currentPage = 1;
  int _totalPages = 1;
  int _totalCount = 0;
  static const int _pageSize = 20;

  // Dashboard tab state
  Map<String, dynamic>? _dashboardData;
  bool _dashLoading = false;
  String? _dashError;
  String _dashPeriod = 'all';

  static const _statusFilters = [
    'all',
    'draft',
    'scheduled',
    'active',
    'paused',
    'completed',
    'archived',
  ];

  static const _statusColors = {
    'draft': Colors.grey,
    'scheduled': Colors.indigo,
    'active': Colors.green,
    'paused': Colors.orange,
    'completed': Colors.blue,
    'archived': Colors.brown,
    'cancelled': Colors.red,
  };

  static const _campaignTypeIcons = {
    'email': Icons.mail_outline,
    'web': Icons.language,
    'event': Icons.calendar_today,
    'social': Icons.share,
    'sms': Icons.sms_outlined,
    'webinar': Icons.videocam_outlined,
    'ads': Icons.ads_click,
    'content': Icons.article_outlined,
    'referral': Icons.group_add_outlined,
    'direct_mail': Icons.local_post_office_outlined,
  };

  static const _campaignTypes = [
    'email',
    'web',
    'event',
    'social',
    'sms',
    'webinar',
    'ads',
    'content',
    'referral',
    'direct_mail',
  ];

  static const _campaignChannels = [
    'email',
    'social_media',
    'search',
    'display',
    'sms',
    'direct_mail',
    'webinar',
    'event',
    'content',
    'referral',
  ];

  static const _periodOptions = [
    {'value': 'all', 'label': 'All'},
    {'value': '7d', 'label': '7d'},
    {'value': '30d', 'label': '30d'},
    {'value': '90d', 'label': '90d'},
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(() {
      if (_tabController.index == 1 && _dashboardData == null && !_dashLoading) {
        _loadDashboard();
      }
    });
    _loadCampaigns();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadCampaigns() async {
    setState(() { _loading = true; _error = null; });
    try {
      final queryParams = <String, String>{
        'limit': '$_pageSize',
        'offset': '${(_currentPage - 1) * _pageSize}',
      };
      if (_statusFilter != 'all') {
        queryParams['status'] = _statusFilter;
      }
      if (_search.isNotEmpty) {
        queryParams['search'] = _search;
      }
      final res = await ApiClient.instance.dio.get(
        Endpoints.campaigns,
        queryParameters: queryParams,
      );
      final data = res.data['data'] ?? res.data['campaigns'] ?? [];
      final total = res.data['total'] ?? res.data['totalCount'] ?? (data as List).length;
      if (mounted) {
        setState(() {
          _campaigns = List<Map<String, dynamic>>.from(data);
          _totalCount = total is int ? total : int.tryParse('$total') ?? _campaigns.length;
          _totalPages = (_totalCount / _pageSize).ceil().clamp(1, 9999);
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = 'Failed to load campaigns');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadDashboard() async {
    setState(() { _dashLoading = true; _dashError = null; });
    try {
      final queryParams = <String, String>{};
      if (_dashPeriod != 'all') {
        queryParams['period'] = _dashPeriod;
      }
      final res = await ApiClient.instance.dio.get(
        '${Endpoints.campaigns}/dashboard',
        queryParameters: queryParams,
      );
      final data = res.data['data'] ?? res.data;
      if (mounted) setState(() => _dashboardData = data);
    } catch (e) {
      if (mounted) setState(() => _dashError = 'Failed to load dashboard');
    } finally {
      if (mounted) setState(() => _dashLoading = false);
    }
  }

  List<Map<String, dynamic>> get _filtered {
    return _campaigns.where((c) {
      if (_statusFilter != 'all' && c['status'] != _statusFilter) return false;
      if (_search.isNotEmpty) {
        final q = _search.toLowerCase();
        final name = (c['name'] ?? '').toString().toLowerCase();
        return name.contains(q);
      }
      return true;
    }).toList();
  }

  // ── Formatting helpers ──────────────────────────────────────────────

  String _fmtNum(num n) => n >= 1000 ? '${(n / 1000).toStringAsFixed(1)}k' : '$n';

  String _fmtCurrency(num n) =>
      '\$${n >= 1000 ? '${(n / 1000).toStringAsFixed(1)}k' : n.toStringAsFixed(0)}';

  String _fmtPct(num a, num b) =>
      b > 0 ? '${((a / b) * 100).toStringAsFixed(1)}%' : '0%';

  String _fmtDate(String? iso) {
    if (iso == null || iso.isEmpty) return '--';
    try {
      final d = DateTime.parse(iso);
      return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    } catch (_) {
      return iso;
    }
  }

  IconData _typeIcon(String? type) {
    return _campaignTypeIcons[type ?? ''] ?? Icons.campaign_outlined;
  }

  // ── Dashboard helpers ───────────────────────────────────────────────

  Map<String, int> get _statusCounts {
    final counts = <String, int>{};
    for (final c in _campaigns) {
      final s = (c['status'] ?? 'draft').toString();
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }

  Map<String, int> get _typeCounts {
    final counts = <String, int>{};
    for (final c in _campaigns) {
      final t = (c['type'] ?? 'other').toString();
      counts[t] = (counts[t] ?? 0) + 1;
    }
    return counts;
  }

  Map<String, Map<String, num>> get _channelPerformance {
    final channels = <String, Map<String, num>>{};
    for (final c in _campaigns) {
      final ch = (c['channel'] ?? c['type'] ?? 'other').toString();
      final entry = channels.putIfAbsent(ch, () => {'count': 0, 'revenue': 0});
      entry['count'] = (entry['count'] ?? 0) + 1;
      entry['revenue'] = (entry['revenue'] ?? 0) + (num.tryParse('${c['revenue'] ?? 0}') ?? 0);
    }
    return channels;
  }

  List<Map<String, dynamic>> get _topCampaigns {
    final sorted = List<Map<String, dynamic>>.from(_campaigns);
    sorted.sort((a, b) {
      final aEng = (num.tryParse('${a['opened_count'] ?? a['openedCount'] ?? 0}') ?? 0);
      final bEng = (num.tryParse('${b['opened_count'] ?? b['openedCount'] ?? 0}') ?? 0);
      return bEng.compareTo(aEng);
    });
    return sorted.take(5).toList();
  }

  // ── API Actions ─────────────────────────────────────────────────────

  Future<void> _createCampaign(Map<String, dynamic> data) async {
    try {
      await ApiClient.instance.dio.post(Endpoints.campaigns, data: data);
      if (mounted) {
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Campaign created')),
        );
        _loadCampaigns();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to create campaign: $e')),
        );
      }
    }
  }

  Future<void> _updateCampaignStatus(String id, String status) async {
    try {
      await ApiClient.instance.dio.patch(
        '${Endpoints.campaigns}/$id',
        data: {'status': status},
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Campaign ${status == 'active' ? 'activated' : status}')),
        );
        _loadCampaigns();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update campaign: $e')),
        );
      }
    }
  }

  Future<void> _deleteCampaign(String id) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Campaign'),
        content: const Text(
          'Are you sure you want to delete this campaign? This action cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ApiClient.instance.dio.delete('${Endpoints.campaigns}/$id');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Campaign deleted')),
        );
        _loadCampaigns();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to delete campaign: $e')),
        );
      }
    }
  }

  // ── Create Campaign Bottom Sheet ────────────────────────────────────

  void _showCreateCampaign() {
    final nameCtrl = TextEditingController();
    final budgetCtrl = TextEditingController();
    final audienceCtrl = TextEditingController();
    final goalsCtrl = TextEditingController();
    String selectedType = _campaignTypes.first;
    String selectedChannel = _campaignChannels.first;
    DateTime? startDate;
    DateTime? endDate;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setSheetState) {
            return Padding(
              padding: EdgeInsets.only(
                left: 16,
                right: 16,
                top: 16,
                bottom: MediaQuery.of(ctx).viewInsets.bottom + 16,
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        const Expanded(
                          child: Text(
                            'Create Campaign',
                            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.close),
                          onPressed: () => Navigator.of(ctx).pop(),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),

                    // Name
                    TextField(
                      controller: nameCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Campaign Name *',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                    const SizedBox(height: 12),

                    // Type dropdown
                    DropdownButtonFormField<String>(
                      value: selectedType,
                      decoration: const InputDecoration(
                        labelText: 'Type',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                      items: _campaignTypes
                          .map((t) => DropdownMenuItem(
                                value: t,
                                child: Row(
                                  children: [
                                    Icon(_campaignTypeIcons[t] ?? Icons.campaign, size: 18),
                                    const SizedBox(width: 8),
                                    Text(t.replaceAll('_', ' ')),
                                  ],
                                ),
                              ))
                          .toList(),
                      onChanged: (v) {
                        if (v != null) setSheetState(() => selectedType = v);
                      },
                    ),
                    const SizedBox(height: 12),

                    // Channel dropdown
                    DropdownButtonFormField<String>(
                      value: selectedChannel,
                      decoration: const InputDecoration(
                        labelText: 'Channel',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                      items: _campaignChannels
                          .map((c) => DropdownMenuItem(
                                value: c,
                                child: Text(c.replaceAll('_', ' ')),
                              ))
                          .toList(),
                      onChanged: (v) {
                        if (v != null) setSheetState(() => selectedChannel = v);
                      },
                    ),
                    const SizedBox(height: 12),

                    // Budget
                    TextField(
                      controller: budgetCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Budget',
                        border: OutlineInputBorder(),
                        isDense: true,
                        prefixText: '\$ ',
                      ),
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    ),
                    const SizedBox(height: 12),

                    // Start / End dates
                    Row(
                      children: [
                        Expanded(
                          child: InkWell(
                            onTap: () async {
                              final picked = await showDatePicker(
                                context: ctx,
                                initialDate: startDate ?? DateTime.now(),
                                firstDate: DateTime(2020),
                                lastDate: DateTime(2030),
                              );
                              if (picked != null) setSheetState(() => startDate = picked);
                            },
                            child: InputDecorator(
                              decoration: const InputDecoration(
                                labelText: 'Start Date',
                                border: OutlineInputBorder(),
                                isDense: true,
                                suffixIcon: Icon(Icons.calendar_today, size: 18),
                              ),
                              child: Text(
                                startDate != null ? _fmtDate(startDate!.toIso8601String()) : 'Select',
                                style: TextStyle(
                                  color: startDate != null ? null : Colors.grey,
                                ),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: InkWell(
                            onTap: () async {
                              final picked = await showDatePicker(
                                context: ctx,
                                initialDate: endDate ?? (startDate ?? DateTime.now()),
                                firstDate: DateTime(2020),
                                lastDate: DateTime(2030),
                              );
                              if (picked != null) setSheetState(() => endDate = picked);
                            },
                            child: InputDecorator(
                              decoration: const InputDecoration(
                                labelText: 'End Date',
                                border: OutlineInputBorder(),
                                isDense: true,
                                suffixIcon: Icon(Icons.calendar_today, size: 18),
                              ),
                              child: Text(
                                endDate != null ? _fmtDate(endDate!.toIso8601String()) : 'Select',
                                style: TextStyle(
                                  color: endDate != null ? null : Colors.grey,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),

                    // Target audience
                    TextField(
                      controller: audienceCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Target Audience',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                      maxLines: 2,
                    ),
                    const SizedBox(height: 12),

                    // Goals
                    TextField(
                      controller: goalsCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Goals',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                      maxLines: 2,
                    ),
                    const SizedBox(height: 16),

                    FilledButton.icon(
                      onPressed: () {
                        if (nameCtrl.text.trim().isEmpty) {
                          ScaffoldMessenger.of(ctx).showSnackBar(
                            const SnackBar(content: Text('Campaign name is required')),
                          );
                          return;
                        }
                        final payload = <String, dynamic>{
                          'name': nameCtrl.text.trim(),
                          'type': selectedType,
                          'channel': selectedChannel,
                          'status': 'draft',
                        };
                        if (budgetCtrl.text.isNotEmpty) {
                          payload['budget'] = double.tryParse(budgetCtrl.text) ?? 0;
                        }
                        if (startDate != null) {
                          payload['start_date'] = startDate!.toIso8601String();
                        }
                        if (endDate != null) {
                          payload['end_date'] = endDate!.toIso8601String();
                        }
                        if (audienceCtrl.text.trim().isNotEmpty) {
                          payload['target_audience'] = audienceCtrl.text.trim();
                        }
                        if (goalsCtrl.text.trim().isNotEmpty) {
                          payload['goals'] = goalsCtrl.text.trim();
                        }
                        _createCampaign(payload);
                      },
                      icon: const Icon(Icons.add),
                      label: const Text('Create Campaign'),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  // ── Campaign Detail Bottom Sheet ────────────────────────────────────

  void _showCampaignDetail(Map<String, dynamic> campaign) {
    final theme = Theme.of(context);
    final status = (campaign['status'] ?? 'draft').toString();
    final statusColor = _statusColors[status] ?? Colors.grey;
    final id = '${campaign['id'] ?? campaign['_id'] ?? ''}';

    final sent = num.tryParse('${campaign['sent_count'] ?? campaign['sentCount'] ?? 0}') ?? 0;
    final opened = num.tryParse('${campaign['opened_count'] ?? campaign['openedCount'] ?? 0}') ?? 0;
    final clicked = num.tryParse('${campaign['clicked_count'] ?? campaign['clickedCount'] ?? 0}') ?? 0;
    final converted = num.tryParse('${campaign['converted_count'] ?? campaign['convertedCount'] ?? 0}') ?? 0;
    final leads = num.tryParse('${campaign['leads_generated'] ?? campaign['leadsGenerated'] ?? 0}') ?? 0;
    final mqls = num.tryParse('${campaign['mqls'] ?? 0}') ?? 0;
    final sqls = num.tryParse('${campaign['sqls'] ?? 0}') ?? 0;
    final revenue = num.tryParse('${campaign['revenue'] ?? 0}') ?? 0;
    final budget = num.tryParse('${campaign['budget'] ?? 0}') ?? 0;
    final actualSpend = num.tryParse('${campaign['actual_spend'] ?? campaign['actualSpend'] ?? 0}') ?? 0;
    final contactCount = num.tryParse('${campaign['contact_count'] ?? campaign['contactCount'] ?? 0}') ?? 0;
    final unsubscribed = num.tryParse('${campaign['unsubscribed_count'] ?? campaign['unsubscribedCount'] ?? 0}') ?? 0;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        return DraggableScrollableSheet(
          initialChildSize: 0.85,
          minChildSize: 0.5,
          maxChildSize: 0.95,
          expand: false,
          builder: (ctx, scrollCtrl) {
            return SingleChildScrollView(
              controller: scrollCtrl,
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Header
                  Center(
                    child: Container(
                      width: 40,
                      height: 4,
                      margin: const EdgeInsets.only(bottom: 12),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade300,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  Row(
                    children: [
                      Icon(_typeIcon(campaign['type']?.toString()), size: 28),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          campaign['name'] ?? 'Untitled',
                          style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: statusColor.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      status.toUpperCase(),
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: statusColor,
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Action buttons
                  Row(
                    children: [
                      if (status == 'draft' || status == 'scheduled' || status == 'paused')
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: () {
                              Navigator.of(ctx).pop();
                              _updateCampaignStatus(id, 'active');
                            },
                            icon: const Icon(Icons.play_arrow, size: 18),
                            label: Text(status == 'paused' ? 'Resume' : 'Activate'),
                          ),
                        ),
                      if (status == 'active') ...[
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: () {
                              Navigator.of(ctx).pop();
                              _updateCampaignStatus(id, 'paused');
                            },
                            icon: const Icon(Icons.pause, size: 18),
                            label: const Text('Pause'),
                            style: FilledButton.styleFrom(
                              backgroundColor: Colors.orange,
                            ),
                          ),
                        ),
                      ],
                      const SizedBox(width: 8),
                      IconButton(
                        onPressed: () {
                          Navigator.of(ctx).pop();
                          _deleteCampaign(id);
                        },
                        icon: const Icon(Icons.delete_outline, color: Colors.red),
                        tooltip: 'Delete',
                        style: IconButton.styleFrom(
                          side: const BorderSide(color: Colors.red, width: 1),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),

                  // Metrics grid (8 metrics)
                  Text(
                    'METRICS',
                    style: theme.textTheme.labelSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                      letterSpacing: 1,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 8),
                  GridView.count(
                    crossAxisCount: 2,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    crossAxisSpacing: 8,
                    mainAxisSpacing: 8,
                    childAspectRatio: 2.2,
                    children: [
                      _buildDetailMetricCard(theme, 'Sent', _fmtNum(sent), Icons.send_outlined, Colors.blue),
                      _buildDetailMetricCard(theme, 'Opened', '${_fmtNum(opened)} (${_fmtPct(opened, sent)})', Icons.visibility_outlined, Colors.teal),
                      _buildDetailMetricCard(theme, 'Clicked', '${_fmtNum(clicked)} (${_fmtPct(clicked, sent)})', Icons.touch_app_outlined, Colors.indigo),
                      _buildDetailMetricCard(theme, 'Converted', _fmtNum(converted), Icons.check_circle_outline, Colors.green),
                      _buildDetailMetricCard(theme, 'Leads Generated', _fmtNum(leads), Icons.person_add_outlined, Colors.purple),
                      _buildDetailMetricCard(theme, 'MQLs', _fmtNum(mqls), Icons.star_outline, Colors.amber.shade700),
                      _buildDetailMetricCard(theme, 'SQLs', _fmtNum(sqls), Icons.verified_outlined, Colors.deepOrange),
                      _buildDetailMetricCard(theme, 'Revenue', _fmtCurrency(revenue), Icons.attach_money, Colors.green.shade700),
                    ],
                  ),
                  const SizedBox(height: 20),

                  // Details section
                  Text(
                    'DETAILS',
                    style: theme.textTheme.labelSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                      letterSpacing: 1,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        children: [
                          _detailRow(theme, 'Type', (campaign['type'] ?? '--').toString().replaceAll('_', ' ')),
                          _detailRow(theme, 'Channel', (campaign['channel'] ?? '--').toString().replaceAll('_', ' ')),
                          _detailRow(theme, 'Budget', budget > 0 ? _fmtCurrency(budget) : '--'),
                          _detailRow(theme, 'Actual Spend', actualSpend > 0 ? _fmtCurrency(actualSpend) : '--'),
                          _detailRow(theme, 'Start Date', _fmtDate(campaign['start_date']?.toString() ?? campaign['startDate']?.toString())),
                          _detailRow(theme, 'End Date', _fmtDate(campaign['end_date']?.toString() ?? campaign['endDate']?.toString())),
                          _detailRow(theme, 'Target Audience', (campaign['target_audience'] ?? campaign['targetAudience'] ?? '--').toString()),
                          _detailRow(theme, 'Goals', (campaign['goals'] ?? '--').toString()),
                          _detailRow(theme, 'Contact Count', '$contactCount'),
                          _detailRow(theme, 'Unsubscribed', '$unsubscribed'),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildDetailMetricCard(ThemeData theme, String label, String value, IconData icon, Color color) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Row(
              children: [
                Icon(icon, size: 14, color: color),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    label,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                      fontSize: 11,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 2),
            Text(
              value,
              style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }

  Widget _detailRow(ThemeData theme, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(
              label,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: theme.textTheme.bodyMedium,
            ),
          ),
        ],
      ),
    );
  }

  // ── Build ───────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Marketing'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              _loadCampaigns();
              if (_tabController.index == 1) _loadDashboard();
            },
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(icon: Icon(Icons.campaign_outlined, size: 18), text: 'Campaigns'),
            Tab(icon: Icon(Icons.dashboard_outlined, size: 18), text: 'Dashboard'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildCampaignsTab(theme),
          _buildDashboardTab(theme),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _showCreateCampaign,
        child: const Icon(Icons.add),
      ),
    );
  }

  // ── Campaigns Tab ───────────────────────────────────────────────────

  Widget _buildCampaignsTab(ThemeData theme) {
    if (_loading) return const LoadingIndicator();
    if (_error != null) return ErrorView(message: _error!, onRetry: _loadCampaigns);

    return Column(
      children: [
        // Search bar
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: TextField(
            decoration: InputDecoration(
              hintText: 'Search campaigns...',
              prefixIcon: const Icon(Icons.search, size: 20),
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(vertical: 8),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide.none,
              ),
              filled: true,
              fillColor: theme.colorScheme.surfaceContainerHighest.withOpacity(0.5),
            ),
            onChanged: (v) {
              _search = v;
              _currentPage = 1;
              _loadCampaigns();
            },
          ),
        ),

        // Status filter chips
        SizedBox(
          height: 48,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            itemCount: _statusFilters.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (_, i) {
              final s = _statusFilters[i];
              final selected = _statusFilter == s;
              return FilterChip(
                label: Text(s[0].toUpperCase() + s.substring(1)),
                selected: selected,
                onSelected: (_) {
                  setState(() {
                    _statusFilter = s;
                    _currentPage = 1;
                  });
                  _loadCampaigns();
                },
              );
            },
          ),
        ),

        // Campaign list
        Expanded(
          child: _filtered.isEmpty
              ? const EmptyState(
                  icon: Icons.campaign_outlined,
                  title: 'No campaigns found',
                )
              : RefreshIndicator(
                  onRefresh: _loadCampaigns,
                  child: ListView.separated(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    itemCount: _filtered.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (_, i) => _buildCampaignCard(theme, _filtered[i]),
                  ),
                ),
        ),

        // Pagination controls
        if (_totalPages > 1)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(
              color: theme.colorScheme.surface,
              border: Border(
                top: BorderSide(color: theme.dividerColor),
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                IconButton(
                  onPressed: _currentPage > 1
                      ? () {
                          setState(() => _currentPage = 1);
                          _loadCampaigns();
                        }
                      : null,
                  icon: const Icon(Icons.first_page, size: 20),
                  visualDensity: VisualDensity.compact,
                ),
                IconButton(
                  onPressed: _currentPage > 1
                      ? () {
                          setState(() => _currentPage--);
                          _loadCampaigns();
                        }
                      : null,
                  icon: const Icon(Icons.chevron_left, size: 20),
                  visualDensity: VisualDensity.compact,
                ),
                const SizedBox(width: 8),
                Text(
                  'Page $_currentPage of $_totalPages',
                  style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w500),
                ),
                if (_totalCount > 0)
                  Text(
                    ' ($_totalCount total)',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                const SizedBox(width: 8),
                IconButton(
                  onPressed: _currentPage < _totalPages
                      ? () {
                          setState(() => _currentPage++);
                          _loadCampaigns();
                        }
                      : null,
                  icon: const Icon(Icons.chevron_right, size: 20),
                  visualDensity: VisualDensity.compact,
                ),
                IconButton(
                  onPressed: _currentPage < _totalPages
                      ? () {
                          setState(() => _currentPage = _totalPages);
                          _loadCampaigns();
                        }
                      : null,
                  icon: const Icon(Icons.last_page, size: 20),
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildCampaignCard(ThemeData theme, Map<String, dynamic> c) {
    final status = c['status'] ?? 'draft';
    final color = _statusColors[status] ?? Colors.grey;
    final type = (c['type'] ?? '').toString();
    final channel = (c['channel'] ?? '').toString();
    final sent = num.tryParse('${c['sent_count'] ?? c['sentCount'] ?? 0}') ?? 0;
    final opened = num.tryParse('${c['opened_count'] ?? c['openedCount'] ?? 0}') ?? 0;
    final clicked = num.tryParse('${c['clicked_count'] ?? c['clickedCount'] ?? 0}') ?? 0;
    final revenue = num.tryParse('${c['revenue'] ?? 0}') ?? 0;
    final budget = num.tryParse('${c['budget'] ?? 0}') ?? 0;
    final startDate = c['start_date']?.toString() ?? c['startDate']?.toString();
    final endDate = c['end_date']?.toString() ?? c['endDate']?.toString();
    final openRate = _fmtPct(opened, sent);
    final clickRate = _fmtPct(clicked, sent);

    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _showCampaignDetail(c),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Title row with type icon
              Row(
                children: [
                  Icon(_typeIcon(type), size: 20, color: theme.colorScheme.primary),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      c['name'] ?? 'Untitled',
                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const Icon(Icons.chevron_right, size: 20),
                ],
              ),
              const SizedBox(height: 8),

              // Status + type + channel row
              Wrap(
                spacing: 8,
                runSpacing: 4,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: color.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      status.toString().toUpperCase(),
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                        color: color,
                      ),
                    ),
                  ),
                  if (type.isNotEmpty)
                    Text(
                      type.replaceAll('_', ' '),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  if (channel.isNotEmpty)
                    Text(
                      '| ${channel.replaceAll('_', ' ')}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                ],
              ),

              // Dates row
              if (startDate != null || endDate != null) ...[
                const SizedBox(height: 6),
                Row(
                  children: [
                    Icon(Icons.date_range, size: 14, color: theme.colorScheme.onSurfaceVariant),
                    const SizedBox(width: 4),
                    Text(
                      '${_fmtDate(startDate)} - ${_fmtDate(endDate)}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                        fontSize: 11,
                      ),
                    ),
                    if (budget > 0) ...[
                      const Spacer(),
                      Icon(Icons.account_balance_wallet_outlined, size: 14, color: theme.colorScheme.onSurfaceVariant),
                      const SizedBox(width: 4),
                      Text(
                        _fmtCurrency(budget),
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                          fontWeight: FontWeight.w500,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ],
                ),
              ],

              // Stats row
              if (sent > 0 || revenue > 0) ...[
                const SizedBox(height: 8),
                const Divider(height: 1),
                const SizedBox(height: 8),
                Row(
                  children: [
                    if (sent > 0) ...[
                      _buildMiniStat(theme, 'Sent', _fmtNum(sent)),
                      const SizedBox(width: 12),
                      _buildMiniStat(theme, 'Open', openRate),
                      const SizedBox(width: 12),
                      _buildMiniStat(theme, 'Click', clickRate),
                    ],
                    if (clicked > 0) ...[
                      const SizedBox(width: 12),
                      _buildMiniStat(theme, 'Clicks', _fmtNum(clicked)),
                    ],
                    const Spacer(),
                    if (revenue > 0)
                      Text(
                        _fmtCurrency(revenue),
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: Colors.green.shade700,
                        ),
                      ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMiniStat(ThemeData theme, String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: theme.textTheme.bodySmall?.copyWith(
            fontSize: 10,
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        Text(
          value,
          style: theme.textTheme.bodySmall?.copyWith(
            fontWeight: FontWeight.w600,
            fontSize: 12,
          ),
        ),
      ],
    );
  }

  // ── Dashboard Tab ───────────────────────────────────────────────────

  Widget _buildDashboardTab(ThemeData theme) {
    // Use API dashboard data if available, otherwise derive from campaigns list
    final summary = _dashboardData?['summary'] as Map<String, dynamic>?;
    final byChannel = _dashboardData?['byChannel'] as List? ?? [];
    final topFromApi = _dashboardData?['topCampaigns'] as List? ?? [];

    if (_dashLoading && _dashboardData == null && _loading) {
      return const LoadingIndicator();
    }
    if (_dashError != null && _dashboardData == null && _campaigns.isEmpty) {
      return ErrorView(message: _dashError!, onRetry: _loadDashboard);
    }

    return RefreshIndicator(
      onRefresh: () async {
        await _loadCampaigns();
        await _loadDashboard();
      },
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Period selector
          Row(
            children: [
              Text('PERIOD', style: theme.textTheme.labelSmall?.copyWith(
                fontWeight: FontWeight.w600, letterSpacing: 1,
                color: theme.colorScheme.onSurfaceVariant,
              )),
              const Spacer(),
              ..._periodOptions.map((opt) {
                final selected = _dashPeriod == opt['value'];
                return Padding(
                  padding: const EdgeInsets.only(left: 4),
                  child: ChoiceChip(
                    label: Text(opt['label']!, style: const TextStyle(fontSize: 11)),
                    selected: selected,
                    onSelected: (_) {
                      setState(() => _dashPeriod = opt['value']!);
                      _loadDashboard();
                    },
                    visualDensity: VisualDensity.compact,
                  ),
                );
              }),
            ],
          ),
          const SizedBox(height: 16),

          // Campaign count by status
          Text('CAMPAIGNS BY STATUS', style: theme.textTheme.labelSmall?.copyWith(
            fontWeight: FontWeight.w600, letterSpacing: 1,
            color: theme.colorScheme.onSurfaceVariant,
          )),
          const SizedBox(height: 8),
          _buildStatusCountsSection(theme, summary),
          const SizedBox(height: 20),

          // Performance metrics
          Text('PERFORMANCE METRICS', style: theme.textTheme.labelSmall?.copyWith(
            fontWeight: FontWeight.w600, letterSpacing: 1,
            color: theme.colorScheme.onSurfaceVariant,
          )),
          const SizedBox(height: 8),
          _buildPerformanceMetrics(theme, summary),
          const SizedBox(height: 20),

          // Campaign type breakdown
          Text('CAMPAIGN TYPES', style: theme.textTheme.labelSmall?.copyWith(
            fontWeight: FontWeight.w600, letterSpacing: 1,
            color: theme.colorScheme.onSurfaceVariant,
          )),
          const SizedBox(height: 8),
          _buildTypeBreakdown(theme),
          const SizedBox(height: 20),

          // Channel performance
          Text('CHANNEL PERFORMANCE', style: theme.textTheme.labelSmall?.copyWith(
            fontWeight: FontWeight.w600, letterSpacing: 1,
            color: theme.colorScheme.onSurfaceVariant,
          )),
          const SizedBox(height: 8),
          _buildChannelPerformance(theme, byChannel),
          const SizedBox(height: 20),

          // Top performing campaigns
          Text('TOP CAMPAIGNS', style: theme.textTheme.labelSmall?.copyWith(
            fontWeight: FontWeight.w600, letterSpacing: 1,
            color: theme.colorScheme.onSurfaceVariant,
          )),
          const SizedBox(height: 8),
          _buildTopCampaigns(theme, topFromApi),
          const SizedBox(height: 80), // Space for FAB
        ],
      ),
    );
  }

  Widget _buildStatusCountsSection(ThemeData theme, Map<String, dynamic>? summary) {
    final counts = _statusCounts;
    final totalFromApi = summary?['total_campaigns'];
    final activeFromApi = summary?['active_campaigns'];

    final items = <_MetricItem>[
      _MetricItem(
        label: 'Total',
        value: '${totalFromApi ?? _campaigns.length}',
        icon: Icons.campaign,
        color: Colors.blue,
      ),
      _MetricItem(
        label: 'Active',
        value: '${activeFromApi ?? counts['active'] ?? 0}',
        icon: Icons.play_circle_outline,
        color: Colors.green,
      ),
      _MetricItem(
        label: 'Draft',
        value: '${counts['draft'] ?? 0}',
        icon: Icons.edit_outlined,
        color: Colors.grey,
      ),
      _MetricItem(
        label: 'Completed',
        value: '${counts['completed'] ?? 0}',
        icon: Icons.check_circle_outline,
        color: Colors.blue,
      ),
    ];

    return _buildMetricGrid(theme, items);
  }

  Widget _buildPerformanceMetrics(ThemeData theme, Map<String, dynamic>? summary) {
    final totalSent = summary?['total_sent'] ?? 0;
    final totalOpened = summary?['total_opened'] ?? 0;
    final totalClicked = summary?['total_clicked'] ?? 0;
    final totalConverted = summary?['total_converted'] ?? 0;
    final totalRevenue = summary?['total_revenue'] ?? 0;
    final totalBudget = summary?['total_budget'] ?? 0;

    // Calculate from campaigns list if API summary not available
    num calcTotalSent = totalSent;
    num calcTotalOpened = totalOpened;
    num calcTotalClicked = totalClicked;
    num calcTotalConverted = totalConverted;
    num calcRevenue = totalRevenue;
    num calcBudget = totalBudget;

    if (summary == null) {
      for (final c in _campaigns) {
        calcTotalSent += (num.tryParse('${c['sent_count'] ?? c['sentCount'] ?? 0}') ?? 0);
        calcTotalOpened += (num.tryParse('${c['opened_count'] ?? c['openedCount'] ?? 0}') ?? 0);
        calcTotalClicked += (num.tryParse('${c['clicked_count'] ?? c['clickedCount'] ?? 0}') ?? 0);
        calcTotalConverted += (num.tryParse('${c['converted_count'] ?? c['convertedCount'] ?? 0}') ?? 0);
        calcRevenue += (num.tryParse('${c['revenue'] ?? 0}') ?? 0);
        calcBudget += (num.tryParse('${c['budget'] ?? 0}') ?? 0);
      }
    }

    final items = <_MetricItem>[
      _MetricItem(
        label: 'Total Reach',
        value: _fmtNum(summary != null ? totalSent : calcTotalSent),
        icon: Icons.people_outline,
        color: Colors.indigo,
      ),
      _MetricItem(
        label: 'Engagement',
        value: _fmtPct(summary != null ? totalOpened : calcTotalOpened,
            summary != null ? totalSent : calcTotalSent),
        icon: Icons.visibility_outlined,
        color: Colors.teal,
      ),
      _MetricItem(
        label: 'Conversion',
        value: _fmtPct(summary != null ? totalConverted : calcTotalConverted,
            summary != null ? totalSent : calcTotalSent),
        icon: Icons.trending_up,
        color: Colors.green,
      ),
      _MetricItem(
        label: 'ROI',
        value: (summary != null ? calcBudget : calcBudget) > 0
            ? '${(((summary != null ? calcRevenue : calcRevenue) / (summary != null ? calcBudget : calcBudget)) * 100).toStringAsFixed(0)}%'
            : 'N/A',
        icon: Icons.attach_money,
        color: Colors.amber.shade700,
      ),
    ];

    return _buildMetricGrid(theme, items);
  }

  Widget _buildMetricGrid(ThemeData theme, List<_MetricItem> items) {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisSpacing: 8,
      mainAxisSpacing: 8,
      childAspectRatio: 2.2,
      children: items.map((item) => Card(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Row(
                children: [
                  Icon(item.icon, size: 16, color: item.color),
                  const SizedBox(width: 6),
                  Text(item.label, style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  )),
                ],
              ),
              const SizedBox(height: 4),
              Text(item.value, style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.bold,
              )),
            ],
          ),
        ),
      )).toList(),
    );
  }

  Widget _buildTypeBreakdown(ThemeData theme) {
    final types = _typeCounts;
    if (types.isEmpty) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Center(child: Text('No campaign data',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant))),
        ),
      );
    }

    final total = types.values.fold<int>(0, (a, b) => a + b);
    final typeColors = [
      Colors.blue, Colors.green, Colors.orange, Colors.purple,
      Colors.teal, Colors.red, Colors.indigo, Colors.pink,
    ];

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            // Simple bar representation
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: SizedBox(
                height: 24,
                child: Row(
                  children: types.entries.toList().asMap().entries.map((entry) {
                    final idx = entry.key;
                    final e = entry.value;
                    final pct = total > 0 ? e.value / total : 0.0;
                    return Expanded(
                      flex: (pct * 100).round().clamp(1, 100),
                      child: Container(
                        color: typeColors[idx % typeColors.length],
                      ),
                    );
                  }).toList(),
                ),
              ),
            ),
            const SizedBox(height: 12),
            // Legend
            Wrap(
              spacing: 12,
              runSpacing: 6,
              children: types.entries.toList().asMap().entries.map((entry) {
                final idx = entry.key;
                final e = entry.value;
                return Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 10, height: 10,
                      decoration: BoxDecoration(
                        color: typeColors[idx % typeColors.length],
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                    const SizedBox(width: 4),
                    Text('${e.key} (${e.value})', style: const TextStyle(fontSize: 12)),
                  ],
                );
              }).toList(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildChannelPerformance(ThemeData theme, List<dynamic> byChannelApi) {
    // Prefer API data, fall back to derived data
    final channels = <String, Map<String, num>>{};
    if (byChannelApi.isNotEmpty) {
      for (final ch in byChannelApi) {
        final name = (ch['channel'] ?? 'other').toString();
        channels[name] = {
          'count': (num.tryParse('${ch['count'] ?? 0}') ?? 0),
          'revenue': (num.tryParse('${ch['revenue'] ?? 0}') ?? 0),
        };
      }
    } else {
      channels.addAll(_channelPerformance);
    }

    if (channels.isEmpty) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Center(child: Text('No channel data',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant))),
        ),
      );
    }

    final maxRevenue = channels.values.fold<num>(0, (a, b) {
      final r = b['revenue'] ?? 0;
      return r > a ? r : a;
    });

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: channels.entries.map((e) {
            final pctWidth = maxRevenue > 0 ? (e.value['revenue']! / maxRevenue) : 0.0;
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  SizedBox(
                    width: 80,
                    child: Text(
                      e.key.replaceAll('_', ' '),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: pctWidth.toDouble(),
                        minHeight: 16,
                        backgroundColor: theme.colorScheme.surfaceContainerHighest,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(
                    width: 50,
                    child: Text(
                      '${e.value['count']}',
                      style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600),
                      textAlign: TextAlign.right,
                    ),
                  ),
                ],
              ),
            );
          }).toList(),
        ),
      ),
    );
  }

  Widget _buildTopCampaigns(ThemeData theme, List<dynamic> topFromApi) {
    final top = topFromApi.isNotEmpty
        ? topFromApi.take(5).toList()
        : _topCampaigns;

    if (top.isEmpty) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Center(child: Text('No campaigns yet',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant))),
        ),
      );
    }

    return Card(
      child: Column(
        children: top.asMap().entries.map((entry) {
          final idx = entry.key;
          final camp = entry.value;
          final name = camp['name'] ?? 'Untitled';
          final type = camp['type'] ?? '';
          final status = camp['status'] ?? '';
          final engagement = camp['opened'] ?? camp['opened_count'] ?? camp['openedCount'] ?? 0;

          return ListTile(
            leading: CircleAvatar(
              radius: 14,
              backgroundColor: theme.colorScheme.primaryContainer,
              child: Text('${idx + 1}',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold,
                      color: theme.colorScheme.onPrimaryContainer)),
            ),
            title: Text(name, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                maxLines: 1, overflow: TextOverflow.ellipsis),
            subtitle: Text('$type  ·  $status',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
            trailing: Text('$engagement opens',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600,
                    color: Colors.green.shade700)),
            dense: true,
          );
        }).toList(),
      ),
    );
  }
}

class _MetricItem {
  final String label;
  final String value;
  final IconData icon;
  final Color color;

  const _MetricItem({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
  });
}
