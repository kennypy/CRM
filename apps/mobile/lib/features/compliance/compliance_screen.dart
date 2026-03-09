import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

// ── Status helpers ───────────────────────────────────────────────────────────

const _statusColors = {
  'implemented': Colors.green,
  'in_progress': Colors.amber,
  'not_started': Colors.grey,
  'not_applicable': Colors.blueGrey,
};

const _statusLabels = {
  'implemented': 'Implemented',
  'in_progress': 'In Progress',
  'not_started': 'Not Started',
  'not_applicable': 'N/A',
};

const _statusIcons = {
  'implemented': Icons.check_circle,
  'in_progress': Icons.access_time,
  'not_started': Icons.cancel_outlined,
  'not_applicable': Icons.remove_circle_outline,
};

const _soc2Categories = [
  'Access Control',
  'Change Management',
  'Risk Assessment',
  'Monitoring',
  'Incident Response',
  'Vendor Management',
  'Data Protection',
  'Business Continuity',
];

// ── Demo data (mirrors web implementation) ───────────────────────────────────

final _demoControls = <Map<String, dynamic>>[
  {'id': 'ac-1', 'category': 'Access Control', 'name': 'Multi-Factor Authentication', 'description': 'MFA enforced for all user accounts', 'status': 'implemented', 'owner': 'Sarah Kim', 'lastReviewedAt': '2026-02-15', 'evidence': 'MFA policy doc v3.2'},
  {'id': 'ac-2', 'category': 'Access Control', 'name': 'Role-Based Access Control', 'description': 'RBAC implemented across all modules', 'status': 'implemented', 'owner': 'Sarah Kim', 'lastReviewedAt': '2026-02-15', 'evidence': 'RBAC matrix v2.1'},
  {'id': 'ac-3', 'category': 'Access Control', 'name': 'Session Management', 'description': 'Auto-logout after 30 min inactivity', 'status': 'implemented', 'owner': 'Marcus Chen', 'lastReviewedAt': '2026-01-20'},
  {'id': 'cm-1', 'category': 'Change Management', 'name': 'Change Advisory Board', 'description': 'All production changes reviewed by CAB', 'status': 'implemented', 'owner': 'Marcus Chen', 'lastReviewedAt': '2026-02-01', 'evidence': 'CAB meeting minutes'},
  {'id': 'cm-2', 'category': 'Change Management', 'name': 'Automated CI/CD Pipeline', 'description': 'All deployments go through automated pipeline with tests', 'status': 'implemented', 'owner': 'DevOps Team', 'lastReviewedAt': '2026-02-10'},
  {'id': 'cm-3', 'category': 'Change Management', 'name': 'Rollback Procedures', 'description': 'Documented rollback for every deployment', 'status': 'in_progress', 'owner': 'DevOps Team', 'lastReviewedAt': '2026-01-28'},
  {'id': 'ra-1', 'category': 'Risk Assessment', 'name': 'Annual Risk Assessment', 'description': 'Comprehensive risk assessment conducted annually', 'status': 'implemented', 'owner': 'Priya Sharma', 'lastReviewedAt': '2026-01-05', 'evidence': 'Risk register 2026'},
  {'id': 'ra-2', 'category': 'Risk Assessment', 'name': 'Threat Modeling', 'description': 'Threat models for all new features', 'status': 'in_progress', 'owner': 'Priya Sharma', 'lastReviewedAt': '2025-12-15'},
  {'id': 'mo-1', 'category': 'Monitoring', 'name': 'SIEM Integration', 'description': 'Centralized security event monitoring', 'status': 'implemented', 'owner': 'Marcus Chen', 'lastReviewedAt': '2026-02-20', 'evidence': 'SIEM dashboard'},
  {'id': 'mo-2', 'category': 'Monitoring', 'name': 'Anomaly Detection', 'description': 'ML-based anomaly detection on access patterns', 'status': 'in_progress', 'owner': 'Marcus Chen', 'lastReviewedAt': '2026-01-30'},
  {'id': 'mo-3', 'category': 'Monitoring', 'name': 'Uptime Monitoring', 'description': '99.9% uptime SLA with automated alerting', 'status': 'implemented', 'owner': 'DevOps Team', 'lastReviewedAt': '2026-02-18'},
  {'id': 'ir-1', 'category': 'Incident Response', 'name': 'Incident Response Plan', 'description': 'Documented IRP with defined escalation paths', 'status': 'implemented', 'owner': 'Sarah Kim', 'lastReviewedAt': '2026-02-05', 'evidence': 'IRP v4.0'},
  {'id': 'ir-2', 'category': 'Incident Response', 'name': 'Tabletop Exercises', 'description': 'Quarterly incident response drills', 'status': 'implemented', 'owner': 'Sarah Kim', 'lastReviewedAt': '2026-01-15'},
  {'id': 'ir-3', 'category': 'Incident Response', 'name': 'Post-Incident Reviews', 'description': 'Blameless post-mortems after every incident', 'status': 'implemented', 'owner': 'Marcus Chen', 'lastReviewedAt': '2026-02-12'},
  {'id': 'vm-1', 'category': 'Vendor Management', 'name': 'Vendor Risk Assessment', 'description': 'All vendors assessed before onboarding', 'status': 'implemented', 'owner': 'Priya Sharma', 'lastReviewedAt': '2026-01-20', 'evidence': 'Vendor registry'},
  {'id': 'vm-2', 'category': 'Vendor Management', 'name': 'Vendor SLA Monitoring', 'description': 'Continuous monitoring of vendor SLAs', 'status': 'not_started', 'owner': 'Priya Sharma', 'lastReviewedAt': '2025-11-10'},
  {'id': 'dp-1', 'category': 'Data Protection', 'name': 'Encryption at Rest', 'description': 'AES-256 encryption for all stored data', 'status': 'implemented', 'owner': 'DevOps Team', 'lastReviewedAt': '2026-02-01', 'evidence': 'Encryption policy'},
  {'id': 'dp-2', 'category': 'Data Protection', 'name': 'Data Classification', 'description': 'All data classified by sensitivity level', 'status': 'in_progress', 'owner': 'Priya Sharma', 'lastReviewedAt': '2026-01-25'},
  {'id': 'dp-3', 'category': 'Data Protection', 'name': 'DLP Controls', 'description': 'Data loss prevention rules active', 'status': 'not_started', 'owner': 'Marcus Chen', 'lastReviewedAt': '2025-12-01'},
  {'id': 'bc-1', 'category': 'Business Continuity', 'name': 'Disaster Recovery Plan', 'description': 'Documented DR plan with RTO/RPO targets', 'status': 'implemented', 'owner': 'Sarah Kim', 'lastReviewedAt': '2026-02-08', 'evidence': 'DR plan v2.3'},
  {'id': 'bc-2', 'category': 'Business Continuity', 'name': 'Backup Verification', 'description': 'Weekly backup restoration tests', 'status': 'implemented', 'owner': 'DevOps Team', 'lastReviewedAt': '2026-02-22'},
  {'id': 'bc-3', 'category': 'Business Continuity', 'name': 'Geographic Redundancy', 'description': 'Multi-region deployment for failover', 'status': 'in_progress', 'owner': 'DevOps Team', 'lastReviewedAt': '2026-01-30'},
];

final _demoEscrow = <Map<String, dynamic>>[
  {'id': 'e-1', 'timestamp': '2026-03-07T02:00:00Z', 'provider': 'Iron Mountain', 'sizeBytes': 4832000000, 'status': 'verified', 'verificationHash': 'sha256:a3f2c8...'},
  {'id': 'e-2', 'timestamp': '2026-03-06T02:00:00Z', 'provider': 'Iron Mountain', 'sizeBytes': 4815000000, 'status': 'completed', 'verificationHash': 'sha256:b1d4e7...'},
  {'id': 'e-3', 'timestamp': '2026-03-05T02:00:00Z', 'provider': 'Iron Mountain', 'sizeBytes': 4798000000, 'status': 'verified', 'verificationHash': 'sha256:c9f1a2...'},
  {'id': 'e-4', 'timestamp': '2026-03-04T02:00:00Z', 'provider': 'Iron Mountain', 'sizeBytes': 4780000000, 'status': 'verified', 'verificationHash': 'sha256:d2e5b8...'},
  {'id': 'e-5', 'timestamp': '2026-03-03T02:00:00Z', 'provider': 'Iron Mountain', 'sizeBytes': 4761000000, 'status': 'failed'},
  {'id': 'e-6', 'timestamp': '2026-03-02T02:00:00Z', 'provider': 'Iron Mountain', 'sizeBytes': 4745000000, 'status': 'verified', 'verificationHash': 'sha256:f7a3c1...'},
];

final _demoMirrorDestinations = <Map<String, dynamic>>[
  {
    'id': 'm-1', 'provider': 'aws_s3', 'region': 'us-east-1', 'bucket': 'acme-crm-mirror-prod',
    'format': 'parquet', 'syncFrequency': 'hourly', 'status': 'active', 'lastSyncAt': '2026-03-08T01:00:00Z',
    'objectsSelected': ['contacts', 'companies', 'deals', 'activities', 'emails'],
  },
  {
    'id': 'm-2', 'provider': 'azure_blob', 'region': 'westeurope', 'bucket': 'acme-crm-eu-backup',
    'format': 'json', 'syncFrequency': 'daily', 'status': 'active', 'lastSyncAt': '2026-03-08T00:00:00Z',
    'objectsSelected': ['contacts', 'companies', 'deals'],
  },
];

final _demoRetentionPolicies = <Map<String, dynamic>>[
  {'entityType': 'Contacts', 'retentionDays': 2555, 'archiveAfterDays': 1825, 'deleteAfterDays': 2555, 'legalHold': false},
  {'entityType': 'Companies', 'retentionDays': 2555, 'archiveAfterDays': 1825, 'deleteAfterDays': 2555, 'legalHold': false},
  {'entityType': 'Deals', 'retentionDays': 3650, 'archiveAfterDays': 2555, 'deleteAfterDays': 3650, 'legalHold': true},
  {'entityType': 'Emails', 'retentionDays': 1825, 'archiveAfterDays': 730, 'deleteAfterDays': 1825, 'legalHold': false},
  {'entityType': 'Activities', 'retentionDays': 1095, 'archiveAfterDays': 730, 'deleteAfterDays': 1095, 'legalHold': false},
  {'entityType': 'Audit Logs', 'retentionDays': 2555, 'archiveAfterDays': 1825, 'deleteAfterDays': 2555, 'legalHold': true},
  {'entityType': 'Attachments', 'retentionDays': 1825, 'archiveAfterDays': 365, 'deleteAfterDays': 1825, 'legalHold': false},
  {'entityType': 'Notes', 'retentionDays': 1825, 'archiveAfterDays': 730, 'deleteAfterDays': 1825, 'legalHold': false},
];

// ── Main Screen ──────────────────────────────────────────────────────────────

class ComplianceScreen extends ConsumerStatefulWidget {
  const ComplianceScreen({super.key});

  @override
  ConsumerState<ComplianceScreen> createState() => _ComplianceScreenState();
}

class _ComplianceScreenState extends ConsumerState<ComplianceScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<Map<String, dynamic>> _controls = [];
  List<Map<String, dynamic>> _escrowEntries = [];
  List<Map<String, dynamic>> _mirrorDestinations = [];
  List<Map<String, dynamic>> _retentionPolicies = [];
  bool _loading = true;
  String? _error;

  // Controls tab state
  String _selectedCategory = 'all';
  final Set<String> _expandedCategories = {};

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _loadData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        ApiClient.instance.dio.get(Endpoints.complianceControls),
        ApiClient.instance.dio.get(Endpoints.complianceEscrow),
        ApiClient.instance.dio.get(Endpoints.complianceMirroring),
        ApiClient.instance.dio.get(Endpoints.complianceRetention),
      ]);

      final controlsData = results[0].data['data'];
      final escrowData = results[1].data['data'];
      final mirrorData = results[2].data['data'];
      final retentionData = results[3].data['data'];

      if (mounted) {
        setState(() {
          _controls = controlsData is List
              ? List<Map<String, dynamic>>.from(controlsData)
              : _demoControls;
          _escrowEntries = escrowData is List
              ? List<Map<String, dynamic>>.from(escrowData)
              : _demoEscrow;
          _mirrorDestinations = mirrorData is List
              ? List<Map<String, dynamic>>.from(mirrorData)
              : _demoMirrorDestinations;
          _retentionPolicies = retentionData is List
              ? List<Map<String, dynamic>>.from(retentionData)
              : _demoRetentionPolicies;
        });
      }
    } catch (_) {
      // Fall back to demo data on API failure
      if (mounted) {
        setState(() {
          _controls = _demoControls;
          _escrowEntries = _demoEscrow;
          _mirrorDestinations = _demoMirrorDestinations;
          _retentionPolicies = _demoRetentionPolicies;
        });
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  // ── Progress calculation ─────────────────────────────────────────────────

  double get _overallProgress {
    if (_controls.isEmpty) return 0;
    final implemented =
        _controls.where((c) => c['status'] == 'implemented').length;
    return implemented / _controls.length;
  }

  Map<String, int> get _statusCounts {
    final counts = <String, int>{
      'implemented': 0,
      'in_progress': 0,
      'not_started': 0,
    };
    for (final c in _controls) {
      final s = c['status'] as String? ?? 'not_started';
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }

  Map<String, List<Map<String, dynamic>>> get _controlsByCategory {
    final map = <String, List<Map<String, dynamic>>>{};
    for (final c in _controls) {
      final cat = c['category'] as String? ?? 'Other';
      map.putIfAbsent(cat, () => []).add(c);
    }
    return map;
  }

  // ── Build ────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Compliance'),
            Text(
              'Data governance & SOC 2',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadData),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(icon: Icon(Icons.shield_outlined, size: 18), text: 'Controls'),
            Tab(
                icon: Icon(Icons.storage_outlined, size: 18),
                text: 'Data Governance'),
            Tab(
                icon: Icon(Icons.access_time_outlined, size: 18),
                text: 'Retention'),
          ],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? ErrorView(message: _error!, onRetry: _loadData)
              : TabBarView(
                  controller: _tabController,
                  children: [
                    _buildControlsTab(theme),
                    _buildDataGovernanceTab(theme),
                    _buildRetentionTab(theme),
                  ],
                ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 1: Controls
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildControlsTab(ThemeData theme) {
    final counts = _statusCounts;
    final byCategory = _controlsByCategory;

    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          // Progress header
          _ProgressHeader(
            progress: _overallProgress,
            implemented: counts['implemented'] ?? 0,
            inProgress: counts['in_progress'] ?? 0,
            notStarted: counts['not_started'] ?? 0,
            total: _controls.length,
          ),
          const SizedBox(height: 12),

          // Status summary cards
          Row(
            children: [
              _SummaryCard(
                label: 'Implemented',
                count: counts['implemented'] ?? 0,
                color: Colors.green,
              ),
              const SizedBox(width: 8),
              _SummaryCard(
                label: 'In Progress',
                count: counts['in_progress'] ?? 0,
                color: Colors.amber,
              ),
              const SizedBox(width: 8),
              _SummaryCard(
                label: 'Not Started',
                count: counts['not_started'] ?? 0,
                color: Colors.grey,
              ),
            ],
          ),
          const SizedBox(height: 16),

          // Category filter chips
          SizedBox(
            height: 40,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _soc2Categories.length + 1,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                if (index == 0) {
                  return FilterChip(
                    label: const Text('All'),
                    selected: _selectedCategory == 'all',
                    onSelected: (_) =>
                        setState(() => _selectedCategory = 'all'),
                  );
                }
                final cat = _soc2Categories[index - 1];
                return FilterChip(
                  label: Text(cat, style: const TextStyle(fontSize: 12)),
                  selected: _selectedCategory == cat,
                  onSelected: (_) =>
                      setState(() => _selectedCategory = cat),
                );
              },
            ),
          ),
          const SizedBox(height: 12),

          // Expandable category sections
          ...(_selectedCategory == 'all'
                  ? byCategory.entries
                  : byCategory.entries
                      .where((e) => e.key == _selectedCategory))
              .map((entry) => _CategorySection(
                    category: entry.key,
                    controls: entry.value,
                    isExpanded: _expandedCategories.contains(entry.key),
                    onToggle: () {
                      setState(() {
                        if (_expandedCategories.contains(entry.key)) {
                          _expandedCategories.remove(entry.key);
                        } else {
                          _expandedCategories.add(entry.key);
                        }
                      });
                    },
                  )),
        ],
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 2: Data Governance (Escrow + Mirroring + Encryption + Residency)
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildDataGovernanceTab(ThemeData theme) {
    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          // Encryption settings
          _SectionHeader(
            icon: Icons.lock_outline,
            title: 'Encryption',
            subtitle: 'Data protection settings',
          ),
          const SizedBox(height: 8),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                children: [
                  _SettingRow(
                    label: 'Encryption at Rest',
                    value: 'AES-256',
                    icon: Icons.storage,
                    color: Colors.green,
                  ),
                  const Divider(height: 20),
                  _SettingRow(
                    label: 'Encryption in Transit',
                    value: 'TLS 1.3',
                    icon: Icons.swap_horiz,
                    color: Colors.green,
                  ),
                  const Divider(height: 20),
                  _SettingRow(
                    label: 'Key Management',
                    value: 'AWS KMS',
                    icon: Icons.vpn_key,
                    color: Colors.blue,
                  ),
                  const Divider(height: 20),
                  _SettingRow(
                    label: 'Key Rotation',
                    value: 'Every 90 days',
                    icon: Icons.refresh,
                    color: Colors.blue,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),

          // Data Residency
          _SectionHeader(
            icon: Icons.public,
            title: 'Data Residency',
            subtitle: 'Geographic data controls',
          ),
          const SizedBox(height: 8),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                children: [
                  _SettingRow(
                    label: 'Primary Region',
                    value: 'US East (Virginia)',
                    icon: Icons.location_on,
                    color: Colors.green,
                  ),
                  const Divider(height: 20),
                  _SettingRow(
                    label: 'DR Region',
                    value: 'US West (Oregon)',
                    icon: Icons.location_on_outlined,
                    color: Colors.blue,
                  ),
                  const Divider(height: 20),
                  _SettingRow(
                    label: 'EU Data Residency',
                    value: 'Frankfurt, Germany',
                    icon: Icons.flag,
                    color: Colors.amber,
                  ),
                  const Divider(height: 20),
                  _SettingRow(
                    label: 'Cross-border Transfer',
                    value: 'SCCs Active',
                    icon: Icons.swap_calls,
                    color: Colors.green,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),

          // Data Escrow
          _SectionHeader(
            icon: Icons.archive_outlined,
            title: 'Data Escrow',
            subtitle: 'Backup & verification history',
          ),
          const SizedBox(height: 8),
          ..._escrowEntries.map((entry) => _EscrowCard(entry: entry)),
          const SizedBox(height: 20),

          // Data Mirroring
          _SectionHeader(
            icon: Icons.cloud_sync_outlined,
            title: 'Data Mirroring',
            subtitle: 'Mirror destinations & sync status',
          ),
          const SizedBox(height: 8),
          ..._mirrorDestinations
              .map((dest) => _MirrorCard(destination: dest)),
          const SizedBox(height: 20),
        ],
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 3: Retention
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildRetentionTab(ThemeData theme) {
    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          _SectionHeader(
            icon: Icons.access_time,
            title: 'Data Retention Policies',
            subtitle: 'Retention, archival, and deletion schedules',
          ),
          const SizedBox(height: 12),
          ..._retentionPolicies.map((policy) => _RetentionCard(policy: policy)),
        ],
      ),
    );
  }
}

// ── Progress Header ──────────────────────────────────────────────────────────

class _ProgressHeader extends StatelessWidget {
  final double progress;
  final int implemented;
  final int inProgress;
  final int notStarted;
  final int total;

  const _ProgressHeader({
    required this.progress,
    required this.implemented,
    required this.inProgress,
    required this.notStarted,
    required this.total,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final pct = (progress * 100).toStringAsFixed(0);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.shield, color: Colors.green, size: 28),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'SOC 2 Implementation Progress',
                        style: theme.textTheme.titleSmall
                            ?.copyWith(fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '$implemented of $total controls implemented',
                        style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                Text(
                  '$pct%',
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: Colors.green,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: progress,
                minHeight: 10,
                backgroundColor: Colors.grey.withOpacity(0.15),
                valueColor: const AlwaysStoppedAnimation<Color>(Colors.green),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Summary Card ─────────────────────────────────────────────────────────────

class _SummaryCard extends StatelessWidget {
  final String label;
  final int count;
  final Color color;

  const _SummaryCard({
    required this.label,
    required this.count,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
        decoration: BoxDecoration(
          color: color.withOpacity(0.08),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: color.withOpacity(0.2)),
        ),
        child: Column(
          children: [
            Text(
              '$count',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: color,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                  fontSize: 11, color: color, fontWeight: FontWeight.w500),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

// ── Category Section (expandable) ────────────────────────────────────────────

class _CategorySection extends StatelessWidget {
  final String category;
  final List<Map<String, dynamic>> controls;
  final bool isExpanded;
  final VoidCallback onToggle;

  const _CategorySection({
    required this.category,
    required this.controls,
    required this.isExpanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final implemented =
        controls.where((c) => c['status'] == 'implemented').length;
    final total = controls.length;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          InkWell(
            onTap: onToggle,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: Colors.deepPurple.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(Icons.folder_outlined,
                        size: 20, color: Colors.deepPurple),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          category,
                          style: const TextStyle(
                              fontWeight: FontWeight.w600, fontSize: 14),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '$implemented / $total implemented',
                          style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant),
                        ),
                      ],
                    ),
                  ),
                  // Mini progress
                  SizedBox(
                    width: 40,
                    height: 40,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        CircularProgressIndicator(
                          value: total > 0 ? implemented / total : 0,
                          strokeWidth: 3,
                          backgroundColor: Colors.grey.withOpacity(0.15),
                          valueColor: const AlwaysStoppedAnimation<Color>(
                              Colors.green),
                        ),
                        Text(
                          '${total > 0 ? ((implemented / total) * 100).toInt() : 0}%',
                          style: const TextStyle(
                              fontSize: 9, fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Icon(
                    isExpanded
                        ? Icons.keyboard_arrow_up
                        : Icons.keyboard_arrow_down,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ],
              ),
            ),
          ),
          if (isExpanded)
            ...controls.map((control) => _ControlItem(control: control)),
        ],
      ),
    );
  }
}

// ── Single Control Item ──────────────────────────────────────────────────────

class _ControlItem extends StatelessWidget {
  final Map<String, dynamic> control;

  const _ControlItem({required this.control});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final status = control['status'] as String? ?? 'not_started';
    final color = _statusColors[status] ?? Colors.grey;
    final icon = _statusIcons[status] ?? Icons.cancel_outlined;
    final evidence = control['evidence'] as String?;
    final owner = control['owner'] as String? ?? '';
    final lastReviewed = control['lastReviewedAt'] as String?;

    return Container(
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: theme.dividerColor, width: 0.5)),
      ),
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 18, color: color),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      control['name'] ?? '',
                      style: const TextStyle(
                          fontWeight: FontWeight.w600, fontSize: 13),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      control['description'] ?? '',
                      style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
              _StatusBadge(status: status),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              const SizedBox(width: 28),
              Icon(Icons.person_outline,
                  size: 12, color: theme.colorScheme.onSurfaceVariant),
              const SizedBox(width: 4),
              Text(
                owner,
                style: TextStyle(
                    fontSize: 11, color: theme.colorScheme.onSurfaceVariant),
              ),
              if (lastReviewed != null) ...[
                const SizedBox(width: 12),
                Icon(Icons.calendar_today,
                    size: 12, color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: 4),
                Text(
                  _formatDate(lastReviewed),
                  style: TextStyle(
                      fontSize: 11, color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ],
          ),
          if (evidence != null) ...[
            const SizedBox(height: 6),
            Row(
              children: [
                const SizedBox(width: 28),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: Colors.blue.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(color: Colors.blue.withOpacity(0.2)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.description_outlined,
                          size: 12, color: Colors.blue),
                      const SizedBox(width: 4),
                      Text(
                        evidence,
                        style: const TextStyle(
                            fontSize: 11,
                            color: Colors.blue,
                            fontWeight: FontWeight.w500),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  static String _formatDate(String iso) {
    try {
      final d = DateTime.parse(iso);
      const months = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
      ];
      return '${months[d.month - 1]} ${d.day}, ${d.year}';
    } catch (_) {
      return iso;
    }
  }
}

// ── Status Badge ─────────────────────────────────────────────────────────────

class _StatusBadge extends StatelessWidget {
  final String status;

  const _StatusBadge({required this.status});

  @override
  Widget build(BuildContext context) {
    final color = _statusColors[status] ?? Colors.grey;
    final label = _statusLabels[status] ?? status;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Text(
        label,
        style: TextStyle(
            fontSize: 10, color: color, fontWeight: FontWeight.w600),
      ),
    );
  }
}

// ── Section Header ───────────────────────────────────────────────────────────

class _SectionHeader extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;

  const _SectionHeader({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Icon(icon, size: 20, color: theme.colorScheme.primary),
        const SizedBox(width: 8),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title,
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.w600)),
            Text(subtitle,
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ],
        ),
      ],
    );
  }
}

// ── Setting Row ──────────────────────────────────────────────────────────────

class _SettingRow extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color color;

  const _SettingRow({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.all(6),
          decoration: BoxDecoration(
            color: color.withOpacity(0.1),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Icon(icon, size: 16, color: color),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(label,
              style: theme.textTheme.bodyMedium
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
        ),
        Text(
          value,
          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
        ),
      ],
    );
  }
}

// ── Escrow Card ──────────────────────────────────────────────────────────────

class _EscrowCard extends StatelessWidget {
  final Map<String, dynamic> entry;

  const _EscrowCard({required this.entry});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final status = entry['status'] as String? ?? 'unknown';
    final statusColor = _escrowStatusColor(status);
    final sizeBytes = entry['sizeBytes'] as int? ?? 0;
    final hash = entry['verificationHash'] as String?;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: statusColor.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(
                status == 'failed' ? Icons.error_outline : Icons.archive,
                size: 20,
                color: statusColor,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        entry['provider'] ?? '',
                        style: const TextStyle(
                            fontWeight: FontWeight.w600, fontSize: 13),
                      ),
                      const SizedBox(width: 8),
                      _StatusBadge(status: status),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${_formatBytes(sizeBytes)} \u00b7 ${_formatDateTime(entry['timestamp'])}',
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                  if (hash != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      hash,
                      style: TextStyle(
                        fontSize: 10,
                        fontFamily: 'monospace',
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  static Color _escrowStatusColor(String status) {
    switch (status) {
      case 'verified':
        return Colors.blue;
      case 'completed':
        return Colors.green;
      case 'in_progress':
        return Colors.amber;
      case 'failed':
        return Colors.red;
      default:
        return Colors.grey;
    }
  }

  static String _formatBytes(int bytes) {
    if (bytes >= 1000000000) return '${(bytes / 1000000000).toStringAsFixed(1)} GB';
    if (bytes >= 1000000) return '${(bytes / 1000000).toStringAsFixed(1)} MB';
    return '${(bytes / 1000).toStringAsFixed(1)} KB';
  }

  static String _formatDateTime(String? iso) {
    if (iso == null) return '';
    try {
      final d = DateTime.parse(iso);
      const months = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
      ];
      return '${months[d.month - 1]} ${d.day}, ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return '';
    }
  }
}

// ── Mirror Card ──────────────────────────────────────────────────────────────

class _MirrorCard extends StatelessWidget {
  final Map<String, dynamic> destination;

  const _MirrorCard({required this.destination});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final status = destination['status'] as String? ?? 'unknown';
    final provider = destination['provider'] as String? ?? '';
    final region = destination['region'] as String? ?? '';
    final format = destination['format'] as String? ?? '';
    final freq = destination['syncFrequency'] as String? ?? '';
    final objects =
        List<String>.from(destination['objectsSelected'] ?? []);
    final statusColor = status == 'active'
        ? Colors.green
        : status == 'paused'
            ? Colors.amber
            : Colors.red;

    final providerLabel = {
      'aws_s3': 'AWS S3',
      'azure_blob': 'Azure Blob',
      'gcs': 'Google Cloud Storage',
    }[provider] ?? provider;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: statusColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(Icons.cloud_outlined,
                      size: 20, color: statusColor),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        providerLabel,
                        style: const TextStyle(
                            fontWeight: FontWeight.w600, fontSize: 14),
                      ),
                      Text(
                        '$region \u00b7 ${destination['bucket']}',
                        style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                _StatusBadge(status: status),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                _InfoChip(label: format.toUpperCase(), icon: Icons.description_outlined),
                const SizedBox(width: 8),
                _InfoChip(label: freq, icon: Icons.schedule),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 4,
              runSpacing: 4,
              children: objects
                  .map((obj) => Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: Colors.deepPurple.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          obj,
                          style: const TextStyle(
                              fontSize: 11,
                              color: Colors.deepPurple,
                              fontWeight: FontWeight.w500),
                        ),
                      ))
                  .toList(),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Info Chip ─────────────────────────────────────────────────────────────────

class _InfoChip extends StatelessWidget {
  final String label;
  final IconData icon;

  const _InfoChip({required this.label, required this.icon});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withOpacity(0.5),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: theme.colorScheme.onSurfaceVariant),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
                fontSize: 11, color: theme.colorScheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

// ── Retention Card ───────────────────────────────────────────────────────────

class _RetentionCard extends StatelessWidget {
  final Map<String, dynamic> policy;

  const _RetentionCard({required this.policy});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final entityType = policy['entityType'] as String? ?? '';
    final retentionDays = policy['retentionDays'] as int? ?? 0;
    final archiveDays = policy['archiveAfterDays'] as int? ?? 0;
    final deleteDays = policy['deleteAfterDays'] as int? ?? 0;
    final legalHold = policy['legalHold'] as bool? ?? false;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.folder_outlined,
                    size: 18, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    entityType,
                    style: const TextStyle(
                        fontWeight: FontWeight.w600, fontSize: 14),
                  ),
                ),
                if (legalHold)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: Colors.red.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(4),
                      border: Border.all(color: Colors.red.withOpacity(0.3)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.gavel, size: 10, color: Colors.red),
                        const SizedBox(width: 3),
                        const Text(
                          'Legal Hold',
                          style: TextStyle(
                              fontSize: 10,
                              color: Colors.red,
                              fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                _RetentionMetric(
                    label: 'Retain', value: _daysToYears(retentionDays)),
                const SizedBox(width: 16),
                _RetentionMetric(
                    label: 'Archive', value: _daysToYears(archiveDays)),
                const SizedBox(width: 16),
                _RetentionMetric(
                    label: 'Delete', value: _daysToYears(deleteDays)),
              ],
            ),
            const SizedBox(height: 8),
            // Visual timeline bar
            ClipRRect(
              borderRadius: BorderRadius.circular(3),
              child: SizedBox(
                height: 6,
                child: Row(
                  children: [
                    Expanded(
                      flex: archiveDays,
                      child: Container(color: Colors.green.withOpacity(0.5)),
                    ),
                    Expanded(
                      flex: (deleteDays - archiveDays).clamp(1, 99999),
                      child: Container(color: Colors.amber.withOpacity(0.5)),
                    ),
                    Expanded(
                      flex:
                          (retentionDays - deleteDays).abs().clamp(1, 99999),
                      child: Container(color: Colors.red.withOpacity(0.3)),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                _LegendDot(color: Colors.green, label: 'Active'),
                const SizedBox(width: 12),
                _LegendDot(color: Colors.amber, label: 'Archived'),
                const SizedBox(width: 12),
                _LegendDot(color: Colors.red, label: 'Deleted'),
              ],
            ),
          ],
        ),
      ),
    );
  }

  static String _daysToYears(int days) {
    final y = days ~/ 365;
    final d = days % 365;
    if (y == 0) return '${d}d';
    if (d == 0) return '${y}y';
    return '${y}y ${d}d';
  }
}

class _RetentionMetric extends StatelessWidget {
  final String label;
  final String value;

  const _RetentionMetric({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: TextStyle(
                fontSize: 10,
                color: theme.colorScheme.onSurfaceVariant,
                fontWeight: FontWeight.w500)),
        Text(value,
            style:
                const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
      ],
    );
  }
}

class _LegendDot extends StatelessWidget {
  final Color color;
  final String label;

  const _LegendDot({required this.color, required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration:
              BoxDecoration(color: color, borderRadius: BorderRadius.circular(2)),
        ),
        const SizedBox(width: 4),
        Text(label,
            style: TextStyle(
                fontSize: 10,
                color: Theme.of(context).colorScheme.onSurfaceVariant)),
      ],
    );
  }
}
