import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../core/auth/auth_provider.dart';
import '../../core/auth/auth_service.dart';
import '../../shared/widgets/error_view.dart';

class AdminScreen extends ConsumerStatefulWidget {
  const AdminScreen({super.key});

  @override
  ConsumerState<AdminScreen> createState() => _AdminScreenState();
}

class _AdminScreenState extends ConsumerState<AdminScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;

  // Report state
  List<Map<String, dynamic>> _reportTypes = [];
  Map<String, dynamic>? _reportResult;
  String? _selectedReport;
  bool _loadingTypes = true;
  bool _runningReport = false;

  // Overview state
  Map<String, dynamic>? _overviewData;
  Map<String, dynamic>? _platformStats;
  bool _loadingOverview = true;

  // Users state
  List<Map<String, dynamic>> _users = [];
  bool _loadingUsers = true;

  // Workspaces state (super admin only)
  List<Map<String, dynamic>> _workspaces = [];
  bool _loadingWorkspaces = true;
  String _wsSearch = '';

  // Audit Log state
  List<Map<String, dynamic>> _auditEntries = [];
  bool _loadingAudit = true;
  String? _auditUserFilter;
  String? _auditActionFilter;

  // Roles state
  List<Map<String, dynamic>> _roles = [];
  bool _loadingRoles = true;

  // System Health state
  Map<String, dynamic>? _healthData;
  bool _loadingHealth = true;

  // Data Management state
  Map<String, dynamic>? _retentionData;
  List<Map<String, dynamic>> _gdprRequests = [];
  bool _loadingRetention = true;
  bool _loadingGdpr = true;

  @override
  void initState() {
    super.initState();
    final user = ref.read(authProvider).user;
    final isSuperAdmin = user?.isSuperAdmin ?? false;
    // Tabs: Overview, Users, Roles, Audit, Reports, Data, Health + (Workspaces, Merges for super admin)
    _tabController = TabController(length: isSuperAdmin ? 9 : 7, vsync: this);
    _loadReportTypes();
    _loadOverview();
    _loadUsers();
    _loadAuditLog();
    _loadRoles();
    _loadSystemHealth();
    _loadRetention();
    _loadGdprRequests();
    if (isSuperAdmin) {
      _loadWorkspaces();
      _loadPlatformStats();
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadOverview() async {
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.tenant);
      if (mounted) setState(() => _overviewData = res.data['data']);
    } catch (_) {}
    finally { if (mounted) setState(() => _loadingOverview = false); }
  }

  Future<void> _loadPlatformStats() async {
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.adminStats);
      if (mounted) setState(() => _platformStats = res.data['data']);
    } catch (_) {}
  }

  Future<void> _loadUsers() async {
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.users);
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['users'] ?? []) : []);
      if (mounted) setState(() => _users = List<Map<String, dynamic>>.from(items));
    } catch (_) {}
    finally { if (mounted) setState(() => _loadingUsers = false); }
  }

  Future<void> _loadWorkspaces() async {
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.adminTenants);
      final data = res.data['data'];
      final items = data is List ? data : [];
      if (mounted) setState(() => _workspaces = List<Map<String, dynamic>>.from(items));
    } catch (_) {}
    finally { if (mounted) setState(() => _loadingWorkspaces = false); }
  }

  Future<void> _loadReportTypes() async {
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.adminReportTypes);
      if (mounted) {
        setState(() => _reportTypes = List<Map<String, dynamic>>.from(res.data['data'] ?? []));
        if (_reportTypes.isNotEmpty) _runReport(_reportTypes.first['key']);
      }
    } catch (_) {}
    finally { if (mounted) setState(() => _loadingTypes = false); }
  }

  Future<void> _runReport(String reportType) async {
    setState(() { _selectedReport = reportType; _runningReport = true; _reportResult = null; });
    try {
      final res = await ApiClient.instance.dio.post(Endpoints.adminReportRun, data: {'reportType': reportType});
      if (mounted) setState(() => _reportResult = res.data['data']);
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to run report')));
    } finally {
      if (mounted) setState(() => _runningReport = false);
    }
  }

  Future<void> _loadAuditLog() async {
    try {
      final params = <String, String>{};
      if (_auditUserFilter != null) params['userId'] = _auditUserFilter!;
      if (_auditActionFilter != null) params['action'] = _auditActionFilter!;
      final res = await ApiClient.instance.dio.get(Endpoints.adminAuditLog, queryParameters: params);
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['entries'] ?? []) : []);
      if (mounted) setState(() => _auditEntries = List<Map<String, dynamic>>.from(items));
    } catch (_) {}
    finally { if (mounted) setState(() => _loadingAudit = false); }
  }

  Future<void> _loadRoles() async {
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.adminRoles);
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['roles'] ?? []) : []);
      if (mounted) setState(() => _roles = List<Map<String, dynamic>>.from(items));
    } catch (_) {}
    finally { if (mounted) setState(() => _loadingRoles = false); }
  }

  Future<void> _loadSystemHealth() async {
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.adminSystemHealth);
      if (mounted) setState(() => _healthData = res.data['data']);
    } catch (_) {}
    finally { if (mounted) setState(() => _loadingHealth = false); }
  }

  Future<void> _loadRetention() async {
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.adminDataRetention);
      if (mounted) setState(() => _retentionData = res.data['data']);
    } catch (_) {}
    finally { if (mounted) setState(() => _loadingRetention = false); }
  }

  Future<void> _loadGdprRequests() async {
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.adminGdprRequests);
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['requests'] ?? []) : []);
      if (mounted) setState(() => _gdprRequests = List<Map<String, dynamic>>.from(items));
    } catch (_) {}
    finally { if (mounted) setState(() => _loadingGdpr = false); }
  }

  String _fmtNumber(dynamic n) {
    if (n == null) return '0';
    final v = n is num ? n : num.tryParse(n.toString()) ?? 0;
    if (v >= 1000000) return '${(v / 1000000).toStringAsFixed(1)}M';
    if (v >= 1000) return '${(v / 1000).toStringAsFixed(1)}K';
    return v.toString();
  }

  void _showCreateOrgDialog() {
    final formKey = GlobalKey<FormState>();
    final nameCtl = TextEditingController();
    final slugCtl = TextEditingController();
    final firstNameCtl = TextEditingController();
    final lastNameCtl = TextEditingController();
    final emailCtl = TextEditingController();
    final passwordCtl = TextEditingController();
    String previousSlug = '';
    bool submitting = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Form(
              key: formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(child: Text('Create Organisation',
                          style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold))),
                      IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text('Organisation', style: Theme.of(ctx).textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  TextFormField(
                    controller: nameCtl,
                    decoration: const InputDecoration(labelText: 'Organisation name', prefixIcon: Icon(Icons.business)),
                    textInputAction: TextInputAction.next,
                    onChanged: (_) {
                      final name = nameCtl.text.trim().toLowerCase();
                      final slug = name.replaceAll(RegExp(r'[^a-z0-9]+'), '-').replaceAll(RegExp(r'^-|-$'), '');
                      if (slugCtl.text.isEmpty || slugCtl.text == previousSlug) slugCtl.text = slug;
                      previousSlug = slug;
                    },
                    validator: (v) => (v == null || v.trim().length < 2) ? 'Min 2 characters' : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: slugCtl,
                    decoration: const InputDecoration(labelText: 'URL slug', hintText: 'my-company', prefixIcon: Icon(Icons.link)),
                    textInputAction: TextInputAction.next,
                    autocorrect: false,
                    validator: (v) {
                      if (v == null || v.trim().length < 2) return 'Min 2 characters';
                      if (!RegExp(r'^[a-z0-9-]+$').hasMatch(v)) return 'Lowercase letters, numbers, hyphens only';
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),
                  Text('Admin Account', style: Theme.of(ctx).textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  Row(children: [
                    Expanded(child: TextFormField(controller: firstNameCtl, decoration: const InputDecoration(labelText: 'First name'),
                        textInputAction: TextInputAction.next, validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null)),
                    const SizedBox(width: 12),
                    Expanded(child: TextFormField(controller: lastNameCtl, decoration: const InputDecoration(labelText: 'Last name'),
                        textInputAction: TextInputAction.next, validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null)),
                  ]),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: emailCtl,
                    decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.email_outlined)),
                    keyboardType: TextInputType.emailAddress, textInputAction: TextInputAction.next, autocorrect: false,
                    validator: (v) { if (v == null || v.trim().isEmpty) return 'Required'; if (!v.contains('@')) return 'Invalid email'; return null; },
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: passwordCtl,
                    decoration: const InputDecoration(labelText: 'Password', prefixIcon: Icon(Icons.lock_outlined),
                        helperText: '12+ chars, upper/lower, number, special char', helperMaxLines: 2),
                    obscureText: true, textInputAction: TextInputAction.done,
                    validator: (v) {
                      if (v == null || v.length < 12) return 'Min 12 characters';
                      if (!RegExp(r'[a-z]').hasMatch(v)) return 'Need a lowercase letter';
                      if (!RegExp(r'[A-Z]').hasMatch(v)) return 'Need an uppercase letter';
                      if (!RegExp(r'[0-9]').hasMatch(v)) return 'Need a number';
                      if (!RegExp(r'[^a-zA-Z0-9]').hasMatch(v)) return 'Need a special character';
                      return null;
                    },
                  ),
                  const SizedBox(height: 20),
                  SizedBox(height: 48, child: ElevatedButton(
                    onPressed: submitting ? null : () async {
                      if (!formKey.currentState!.validate()) return;
                      setSheetState(() => submitting = true);
                      try {
                        await AuthService.instance.register(
                          tenantName: nameCtl.text.trim(), tenantSlug: slugCtl.text.trim(),
                          firstName: firstNameCtl.text.trim(), lastName: lastNameCtl.text.trim(),
                          email: emailCtl.text.trim(), password: passwordCtl.text,
                        );
                        if (ctx.mounted) {
                          Navigator.pop(ctx);
                          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Organisation created successfully')));
                          _loadWorkspaces();
                        }
                      } catch (e) {
                        if (ctx.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Failed to create organisation')));
                      } finally {
                        if (ctx.mounted) setSheetState(() => submitting = false);
                      }
                    },
                    child: submitting
                        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Create Organisation'),
                  )),
                  const SizedBox(height: 8),
                ],
              ),
            ),
          ),
        ),
      ),
    );
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

    final isSuperAdmin = user.isSuperAdmin;

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Admin Panel'),
            Text(isSuperAdmin ? 'Platform Admin' : 'Workspace Admin',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ],
        ),
        bottom: TabBar(
          controller: _tabController,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          tabs: [
            const Tab(text: 'Overview'),
            const Tab(text: 'Users'),
            const Tab(text: 'Roles'),
            const Tab(text: 'Audit'),
            const Tab(text: 'Reports'),
            const Tab(text: 'Data'),
            const Tab(text: 'Health'),
            if (isSuperAdmin) ...[
              const Tab(text: 'Workspaces'),
              const Tab(text: 'Merges'),
            ],
          ],
        ),
      ),
      floatingActionButton: isSuperAdmin
          ? FloatingActionButton.extended(
              onPressed: _showCreateOrgDialog,
              icon: const Icon(Icons.add),
              label: const Text('New Org'),
            )
          : null,
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildOverviewTab(theme, isSuperAdmin),
          _buildUsersTab(theme),
          _buildRolesTab(theme),
          _buildAuditTab(theme),
          _buildReportsTab(theme),
          _buildDataTab(theme),
          _buildHealthTab(theme),
          if (isSuperAdmin) ...[
            _buildWorkspacesTab(theme),
            _buildMergesTab(theme),
          ],
        ],
      ),
    );
  }

  Widget _buildOverviewTab(ThemeData theme, bool isSuperAdmin) {
    if (_loadingOverview) return const Center(child: CircularProgressIndicator());

    final tenant = _overviewData;
    return RefreshIndicator(
      onRefresh: () async { await _loadOverview(); await _loadUsers(); },
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Platform Stats (super admin)
          if (isSuperAdmin && _platformStats != null) ...[
            Row(
              children: [
                Expanded(child: _StatCard(
                  label: 'Workspaces',
                  value: '${_workspaces.where((w) => w['parentTenantId'] == null).length}',
                  sub: _workspaces.where((w) => w['parentTenantId'] != null).length > 0
                      ? '+ ${_workspaces.where((w) => w['parentTenantId'] != null).length} sub' : null,
                  icon: Icons.business,
                  color: Colors.blue,
                )),
                const SizedBox(width: 8),
                Expanded(child: _StatCard(
                  label: 'Total Users',
                  value: '${_workspaces.fold<int>(0, (s, w) => s + (w['userCount'] as int? ?? 0))}',
                  icon: Icons.people,
                  color: Colors.green,
                )),
              ],
            ),
            const SizedBox(height: 8),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('This Month', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 12),
                    _PlatformStatRow(icon: Icons.api, color: Colors.blue, label: 'API Calls', value: _fmtNumber(_platformStats!['apiCalls'])),
                    _PlatformStatRow(icon: Icons.psychology, color: Colors.purple, label: 'AI Events', value: _fmtNumber(_platformStats!['aiEvents'])),
                    _PlatformStatRow(icon: Icons.email_outlined, color: Colors.green, label: 'Emails', value: _fmtNumber(_platformStats!['emailsSent'])),
                    _PlatformStatRow(icon: Icons.phone_outlined, color: Colors.orange, label: 'Calls', value: _fmtNumber(_platformStats!['callsMade'])),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],

          // Workspace info
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Icon(Icons.business, color: theme.colorScheme.primary),
                    const SizedBox(width: 8),
                    Text('Workspace', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                  ]),
                  const SizedBox(height: 12),
                  _OverviewRow(label: 'Name', value: tenant?['name'] ?? '-'),
                  _OverviewRow(label: 'Slug', value: tenant?['slug'] ?? '-'),
                  _OverviewRow(label: 'Plan', value: (tenant?['plan'] ?? 'starter').toString().toUpperCase()),
                  _OverviewRow(label: 'Currency', value: tenant?['defaultCurrency'] ?? tenant?['default_currency'] ?? 'USD'),
                  _OverviewRow(label: 'Timezone', value: tenant?['timezone'] ?? 'UTC'),
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
                  Row(children: [
                    Icon(Icons.analytics, color: theme.colorScheme.primary),
                    const SizedBox(width: 8),
                    Text('Quick Stats', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                  ]),
                  const SizedBox(height: 12),
                  _OverviewRow(label: 'Users', value: '${_users.length}'),
                  _OverviewRow(label: 'AI Enabled', value: tenant?['settings']?['aiEnabled'] == true ? 'Yes' : 'No'),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Admin Tools
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Icon(Icons.build, color: theme.colorScheme.primary),
                    const SizedBox(width: 8),
                    Text('Admin Tools', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                  ]),
                  const SizedBox(height: 12),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(color: Colors.orange.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
                      child: const Icon(Icons.find_replace, color: Colors.orange, size: 20),
                    ),
                    title: const Text('Data Deduplication', style: TextStyle(fontWeight: FontWeight.w500, fontSize: 14)),
                    subtitle: Text('Find and merge duplicate records', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                    trailing: const Icon(Icons.chevron_right, size: 20),
                    onTap: () => context.push('/admin/dedup'),
                  ),
                  if (isSuperAdmin) ...[
                    const Divider(height: 1),
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(color: Colors.blue.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
                        child: const Icon(Icons.business, color: Colors.blue, size: 20),
                      ),
                      title: const Text('Workspaces', style: TextStyle(fontWeight: FontWeight.w500, fontSize: 14)),
                      subtitle: Text('Manage all workspaces', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                      trailing: const Icon(Icons.chevron_right, size: 20),
                      onTap: () => context.push('/admin/workspaces'),
                    ),
                    const Divider(height: 1),
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(color: Colors.purple.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
                        child: const Icon(Icons.merge, color: Colors.purple, size: 20),
                      ),
                      title: const Text('Workspace Merges', style: TextStyle(fontWeight: FontWeight.w500, fontSize: 14)),
                      subtitle: Text('Manage merge jobs', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                      trailing: const Icon(Icons.chevron_right, size: 20),
                      onTap: () => context.push('/admin/merges'),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildUsersTab(ThemeData theme) {
    if (_loadingUsers) return const Center(child: CircularProgressIndicator());
    if (_users.isEmpty) return const Center(child: Text('No users found'));

    const roleColors = {
      'admin': Colors.purple,
      'super_admin': Colors.red,
      'manager': Colors.blue,
      'read_only': Colors.grey,
      'rep': Colors.green,
    };

    return RefreshIndicator(
      onRefresh: _loadUsers,
      child: ListView.separated(
        itemCount: _users.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (context, index) {
          final u = _users[index];
          final name = u['fullName'] ?? '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim();
          final email = u['email'] ?? '';
          final role = (u['role'] ?? 'rep').toString();
          final roleColor = roleColors[role] ?? Colors.grey;

          return ListTile(
            leading: CircleAvatar(
              backgroundColor: theme.colorScheme.primaryContainer,
              child: Text(name.isNotEmpty ? name[0].toUpperCase() : '?',
                  style: TextStyle(color: theme.colorScheme.onPrimaryContainer)),
            ),
            title: Text(name, style: const TextStyle(fontWeight: FontWeight.w500)),
            subtitle: Text(email),
            trailing: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: roleColor.withOpacity(0.1),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(role.replaceAll('_', ' '),
                  style: TextStyle(fontSize: 11, color: roleColor, fontWeight: FontWeight.w500)),
            ),
          );
        },
      ),
    );
  }

  Widget _buildReportsTab(ThemeData theme) {
    if (_loadingTypes) return const Center(child: CircularProgressIndicator());
    return Column(
      children: [
        SizedBox(
          height: 50,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            children: _reportTypes.map((rt) {
              final isSelected = _selectedReport == rt['key'];
              return Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(label: Text(rt['label'] ?? ''), selected: isSelected, onSelected: (_) => _runReport(rt['key'])),
              );
            }).toList(),
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: _runningReport
              ? const Center(child: CircularProgressIndicator())
              : _reportResult == null
                  ? Center(child: Text('Select a report to run',
                      style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)))
                  : _buildResultTable(),
        ),
      ],
    );
  }

  Widget _buildWorkspacesTab(ThemeData theme) {
    if (_loadingWorkspaces) return const Center(child: CircularProgressIndicator());

    final filtered = _wsSearch.isEmpty ? _workspaces : _workspaces.where((w) {
      final s = _wsSearch.toLowerCase();
      return (w['name'] ?? '').toString().toLowerCase().contains(s) ||
          (w['slug'] ?? '').toString().toLowerCase().contains(s);
    }).toList();

    // Build hierarchy: parents first, then children indented
    final parents = filtered.where((w) => w['parentTenantId'] == null).toList();
    final childMap = <String, List<Map<String, dynamic>>>{};
    for (final w in filtered) {
      if (w['parentTenantId'] != null) {
        childMap.putIfAbsent(w['parentTenantId'], () => []).add(w);
      }
    }

    final ordered = <MapEntry<Map<String, dynamic>, int>>[];
    for (final p in parents) {
      ordered.add(MapEntry(p, 0));
      for (final c in childMap[p['id']] ?? []) {
        ordered.add(MapEntry(c, 1));
      }
    }

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Expanded(child: TextField(
                decoration: InputDecoration(
                  hintText: 'Search workspaces...',
                  prefixIcon: const Icon(Icons.search, size: 20),
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(vertical: 10),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                ),
                onChanged: (v) => setState(() => _wsSearch = v),
              )),
              const SizedBox(width: 8),
              Text('${_workspaces.length}', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
            ],
          ),
        ),
        Expanded(
          child: ordered.isEmpty
              ? const Center(child: Text('No workspaces'))
              : RefreshIndicator(
                  onRefresh: _loadWorkspaces,
                  child: ListView.separated(
                    itemCount: ordered.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final w = ordered[index].key;
                      final depth = ordered[index].value;
                      final childCount = w['childCount'] ?? 0;

                      return ListTile(
                        contentPadding: EdgeInsets.only(left: 16.0 + depth * 28, right: 16),
                        leading: depth > 0
                            ? Icon(Icons.subdirectory_arrow_right, size: 16, color: theme.colorScheme.onSurfaceVariant)
                            : CircleAvatar(
                                radius: 18,
                                backgroundColor: theme.colorScheme.surfaceContainerHighest,
                                child: Icon(Icons.business, size: 18, color: theme.colorScheme.onSurfaceVariant),
                              ),
                        title: Text(w['name'] ?? '', style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 14)),
                        subtitle: Text.rich(TextSpan(children: [
                          TextSpan(text: w['slug'] ?? ''),
                          if (w['dataRegion'] != null) TextSpan(text: ' · ${(w['dataRegion'] ?? '').toString().toUpperCase()}'),
                          if (childCount > 0) TextSpan(
                            text: ' · $childCount sub',
                            style: TextStyle(color: theme.colorScheme.primary),
                          ),
                        ]), style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text('${w['userCount'] ?? 0} users', style: theme.textTheme.bodySmall),
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(
                                color: theme.colorScheme.surfaceContainerHighest,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text((w['plan'] ?? 'starter').toString(),
                                  style: TextStyle(fontSize: 11, color: theme.colorScheme.onSurfaceVariant)),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ),
        ),
      ],
    );
  }

  Widget _buildMergesTab(ThemeData theme) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.merge, size: 48, color: theme.colorScheme.onSurfaceVariant.withOpacity(0.3)),
          const SizedBox(height: 12),
          Text('Workspace Merges', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Text(
              'To start a merge, go to a workspace and select "Merge Into"',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
          const SizedBox(height: 16),
          OutlinedButton(
            onPressed: () => _tabController.animateTo(3),
            child: const Text('Go to Workspaces'),
          ),
        ],
      ),
    );
  }

  Widget _buildRolesTab(ThemeData theme) {
    if (_loadingRoles) return const Center(child: CircularProgressIndicator());

    const builtInRoles = [
      {'name': 'Admin', 'key': 'admin', 'description': 'Full access to all features and settings', 'color': Colors.purple},
      {'name': 'Manager', 'key': 'manager', 'description': 'Team management, reports, and coaching access', 'color': Colors.blue},
      {'name': 'Rep', 'key': 'rep', 'description': 'Standard CRM access for sales activities', 'color': Colors.green},
      {'name': 'Read Only', 'key': 'read_only', 'description': 'View-only access to CRM data', 'color': Colors.grey},
    ];

    const permissionCategories = {
      'CRM': ['View Contacts', 'Edit Contacts', 'Delete Contacts', 'View Deals', 'Edit Deals', 'View Companies'],
      'AI': ['Use AI Assistant', 'View AI Insights', 'Configure AI Models'],
      'Reports': ['View Reports', 'Create Reports', 'Export Reports'],
      'Admin': ['Manage Users', 'Manage Settings', 'View Audit Log'],
      'Billing': ['View Billing', 'Manage Subscription'],
    };

    return RefreshIndicator(
      onRefresh: _loadRoles,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Built-in Roles', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 12),
          ...builtInRoles.map((role) => Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              leading: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: (role['color'] as Color).withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(Icons.shield, color: role['color'] as Color, size: 20),
              ),
              title: Text(role['name'] as String, style: const TextStyle(fontWeight: FontWeight.w500)),
              subtitle: Text(role['description'] as String,
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              trailing: const Icon(Icons.chevron_right, size: 18),
              onTap: () => _showRolePermissions(theme, role['name'] as String, role['key'] as String, permissionCategories),
            ),
          )),
          const SizedBox(height: 16),
          if (_roles.isNotEmpty) ...[
            Text('Custom Roles', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 12),
            ..._roles.map((role) => Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(Icons.person_outline, color: theme.colorScheme.onPrimaryContainer, size: 20),
                ),
                title: Text(role['name']?.toString() ?? '', style: const TextStyle(fontWeight: FontWeight.w500)),
                subtitle: Text(role['description']?.toString() ?? 'Custom role',
                    style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                trailing: Text('${role['userCount'] ?? 0} users',
                    style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              ),
            )),
          ],
        ],
      ),
    );
  }

  void _showRolePermissions(ThemeData theme, String roleName, String roleKey, Map<String, List<String>> categories) {
    final isAdmin = roleKey == 'admin';
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        maxChildSize: 0.95,
        minChildSize: 0.4,
        builder: (ctx, scrollController) => Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text('$roleName Permissions',
                      style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold))),
                  IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
                ],
              ),
              const SizedBox(height: 12),
              Expanded(
                child: ListView(
                  controller: scrollController,
                  children: categories.entries.map((cat) => Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Text(cat.key, style: theme.textTheme.labelMedium?.copyWith(
                            fontWeight: FontWeight.w600, color: theme.colorScheme.primary)),
                      ),
                      ...cat.value.map((perm) => CheckboxListTile(
                        value: isAdmin || roleKey == 'manager' && !perm.contains('Billing') && !perm.contains('Admin')
                            || roleKey == 'rep' && perm.startsWith('View') || roleKey == 'rep' && perm.contains('AI')
                            || roleKey == 'read_only' && perm.startsWith('View'),
                        onChanged: null,
                        title: Text(perm, style: const TextStyle(fontSize: 14)),
                        dense: true,
                        controlAffinity: ListTileControlAffinity.leading,
                        contentPadding: EdgeInsets.zero,
                      )),
                      const Divider(),
                    ],
                  )).toList(),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildAuditTab(ThemeData theme) {
    if (_loadingAudit) return const Center(child: CircularProgressIndicator());

    return Column(
      children: [
        // Filters
        Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String?>(
                  value: _auditActionFilter,
                  decoration: InputDecoration(
                    labelText: 'Action',
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  items: const [
                    DropdownMenuItem(value: null, child: Text('All Actions')),
                    DropdownMenuItem(value: 'create', child: Text('Create')),
                    DropdownMenuItem(value: 'update', child: Text('Update')),
                    DropdownMenuItem(value: 'delete', child: Text('Delete')),
                    DropdownMenuItem(value: 'login', child: Text('Login')),
                    DropdownMenuItem(value: 'export', child: Text('Export')),
                    DropdownMenuItem(value: 'import', child: Text('Import')),
                  ],
                  onChanged: (v) {
                    setState(() => _auditActionFilter = v);
                    _loadAuditLog();
                  },
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                icon: const Icon(Icons.download),
                tooltip: 'Export CSV',
                onPressed: () async {
                  try {
                    await ApiClient.instance.dio.get(Endpoints.adminAuditLogExport);
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Audit log export started')),
                      );
                    }
                  } catch (_) {
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Failed to export audit log')),
                      );
                    }
                  }
                },
              ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: _auditEntries.isEmpty
              ? Center(child: Text('No audit entries', style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant)))
              : RefreshIndicator(
                  onRefresh: _loadAuditLog,
                  child: ListView.separated(
                    itemCount: _auditEntries.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final entry = _auditEntries[index];
                      final action = (entry['action'] ?? '').toString();
                      final entity = (entry['entity'] ?? entry['entityType'] ?? '').toString();
                      final userName = (entry['userName'] ?? entry['user_name'] ?? entry['userEmail'] ?? '').toString();
                      final timestamp = entry['createdAt'] ?? entry['created_at'] ?? entry['timestamp'] ?? '';
                      final ip = (entry['ipAddress'] ?? entry['ip'] ?? '').toString();

                      Color actionColor;
                      IconData actionIcon;
                      switch (action.toLowerCase()) {
                        case 'create': actionColor = Colors.green; actionIcon = Icons.add_circle_outline; break;
                        case 'update': actionColor = Colors.blue; actionIcon = Icons.edit_outlined; break;
                        case 'delete': actionColor = Colors.red; actionIcon = Icons.delete_outline; break;
                        case 'login': actionColor = Colors.purple; actionIcon = Icons.login; break;
                        case 'export': actionColor = Colors.orange; actionIcon = Icons.download; break;
                        case 'import': actionColor = Colors.teal; actionIcon = Icons.upload; break;
                        default: actionColor = Colors.grey; actionIcon = Icons.circle_outlined;
                      }

                      String fmtTime = '';
                      try {
                        final dt = DateTime.parse(timestamp.toString());
                        fmtTime = '${dt.day}/${dt.month}/${dt.year} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
                      } catch (_) {
                        fmtTime = timestamp.toString();
                      }

                      return ListTile(
                        dense: true,
                        leading: Icon(actionIcon, color: actionColor, size: 20),
                        title: Text.rich(TextSpan(children: [
                          TextSpan(text: userName, style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 13)),
                          TextSpan(text: ' $action ', style: TextStyle(color: actionColor, fontWeight: FontWeight.w500, fontSize: 13)),
                          TextSpan(text: entity, style: const TextStyle(fontSize: 13)),
                        ])),
                        subtitle: Row(
                          children: [
                            Text(fmtTime, style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant, fontSize: 11)),
                            if (ip.isNotEmpty) ...[
                              Text(' · ', style: TextStyle(color: theme.colorScheme.onSurfaceVariant, fontSize: 11)),
                              Text(ip, style: theme.textTheme.bodySmall?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant, fontSize: 11)),
                            ],
                          ],
                        ),
                      );
                    },
                  ),
                ),
        ),
      ],
    );
  }

  Widget _buildDataTab(ThemeData theme) {
    return RefreshIndicator(
      onRefresh: () async { await _loadRetention(); await _loadGdprRequests(); },
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Data Export
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Icon(Icons.download, color: theme.colorScheme.primary),
                    const SizedBox(width: 8),
                    Text('Data Export', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                  ]),
                  const SizedBox(height: 12),
                  ...['Contacts', 'Deals', 'Companies', 'Activities'].map((entity) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    leading: const Icon(Icons.table_chart_outlined, size: 20),
                    title: Text(entity, style: const TextStyle(fontSize: 14)),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        TextButton(
                          onPressed: () => _exportData(entity.toLowerCase(), 'csv'),
                          child: const Text('CSV', style: TextStyle(fontSize: 12)),
                        ),
                        TextButton(
                          onPressed: () => _exportData(entity.toLowerCase(), 'json'),
                          child: const Text('JSON', style: TextStyle(fontSize: 12)),
                        ),
                      ],
                    ),
                  )),
                  const Divider(),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    leading: Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(color: Colors.blue.withOpacity(0.1), borderRadius: BorderRadius.circular(6)),
                      child: const Icon(Icons.backup, size: 18, color: Colors.blue),
                    ),
                    title: const Text('Full Backup', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
                    subtitle: Text('Export all data as JSON', style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant)),
                    trailing: OutlinedButton(
                      onPressed: () => _exportData('all', 'json'),
                      child: const Text('Export'),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Retention Policies
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Icon(Icons.schedule, color: theme.colorScheme.primary),
                    const SizedBox(width: 8),
                    Text('Retention Policies', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                  ]),
                  const SizedBox(height: 12),
                  _loadingRetention
                      ? const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()))
                      : Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _OverviewRow(label: 'Retention', value: _retentionData?['retentionPeriod']?.toString() ?? '2 years'),
                            _OverviewRow(label: 'Auto-delete', value: _retentionData?['autoDeleteInactive'] == true ? 'Enabled' : 'Disabled'),
                            _OverviewRow(label: 'Last Cleanup', value: _retentionData?['lastCleanup']?.toString() ?? 'Never'),
                          ],
                        ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // GDPR Data Subject Requests
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Icon(Icons.privacy_tip, color: theme.colorScheme.primary),
                    const SizedBox(width: 8),
                    Text('GDPR Requests', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                  ]),
                  const SizedBox(height: 12),
                  _loadingGdpr
                      ? const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()))
                      : _gdprRequests.isEmpty
                          ? Text('No pending GDPR requests', style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant))
                          : Column(
                              children: _gdprRequests.map((req) {
                                final type = (req['type'] ?? req['requestType'] ?? '').toString();
                                final status = (req['status'] ?? 'pending').toString();
                                final email = (req['email'] ?? req['subjectEmail'] ?? '').toString();
                                Color statusColor;
                                switch (status.toLowerCase()) {
                                  case 'completed': statusColor = Colors.green; break;
                                  case 'processing': statusColor = Colors.blue; break;
                                  case 'pending': statusColor = Colors.orange; break;
                                  default: statusColor = Colors.grey;
                                }
                                return ListTile(
                                  contentPadding: EdgeInsets.zero,
                                  dense: true,
                                  title: Text(type.replaceAll('_', ' ').toUpperCase(),
                                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
                                  subtitle: Text(email, style: theme.textTheme.bodySmall?.copyWith(
                                      color: theme.colorScheme.onSurfaceVariant)),
                                  trailing: Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: statusColor.withOpacity(0.1),
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: Text(status, style: TextStyle(fontSize: 11, color: statusColor, fontWeight: FontWeight.w500)),
                                  ),
                                );
                              }).toList(),
                            ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _exportData(String entity, String format) async {
    try {
      await ApiClient.instance.dio.post(Endpoints.adminDataExport, data: {'entity': entity, 'format': format});
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Export started for $entity ($format)')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to start export')),
        );
      }
    }
  }

  Widget _buildHealthTab(ThemeData theme) {
    if (_loadingHealth) return const Center(child: CircularProgressIndicator());

    final services = List<Map<String, dynamic>>.from(_healthData?['services'] ?? []);
    final rateLimits = _healthData?['rateLimits'] as Map<String, dynamic>?;
    final storage = _healthData?['storage'] as Map<String, dynamic>?;
    final aiTokens = _healthData?['aiTokens'] as Map<String, dynamic>?;
    final webhooks = List<Map<String, dynamic>>.from(_healthData?['webhooks'] ?? []);
    final jobs = List<Map<String, dynamic>>.from(_healthData?['backgroundJobs'] ?? []);

    return RefreshIndicator(
      onRefresh: _loadSystemHealth,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Service Status
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Icon(Icons.monitor_heart, color: theme.colorScheme.primary),
                    const SizedBox(width: 8),
                    Text('Service Status', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                  ]),
                  const SizedBox(height: 12),
                  if (services.isEmpty)
                    Text('No service data available', style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant))
                  else
                    ...services.map((svc) {
                      final name = svc['name']?.toString() ?? '';
                      final status = (svc['status'] ?? 'unknown').toString();
                      final latency = svc['latency']?.toString() ?? '-';
                      final uptime = svc['uptime']?.toString() ?? '-';
                      final isHealthy = status == 'healthy' || status == 'ok' || status == 'up';
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Row(
                          children: [
                            Icon(isHealthy ? Icons.check_circle : Icons.error,
                                size: 16, color: isHealthy ? Colors.green : Colors.red),
                            const SizedBox(width: 8),
                            Expanded(child: Text(name, style: theme.textTheme.bodyMedium)),
                            Text('${latency}ms', style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant)),
                            const SizedBox(width: 12),
                            Text('$uptime%', style: theme.textTheme.bodySmall?.copyWith(
                                fontWeight: FontWeight.w500)),
                          ],
                        ),
                      );
                    }),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // API Rate Limits
          if (rateLimits != null)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Icon(Icons.speed, color: theme.colorScheme.primary),
                      const SizedBox(width: 8),
                      Text('API Rate Limits', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                    ]),
                    const SizedBox(height: 12),
                    _RateLimitBar(
                      label: 'Hourly',
                      used: (rateLimits['hourlyUsed'] as num?)?.toDouble() ?? 0,
                      limit: (rateLimits['hourlyLimit'] as num?)?.toDouble() ?? 1000,
                    ),
                    const SizedBox(height: 8),
                    _RateLimitBar(
                      label: 'Daily',
                      used: (rateLimits['dailyUsed'] as num?)?.toDouble() ?? 0,
                      limit: (rateLimits['dailyLimit'] as num?)?.toDouble() ?? 10000,
                    ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 12),

          // Storage Usage
          if (storage != null)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Icon(Icons.storage, color: theme.colorScheme.primary),
                      const SizedBox(width: 8),
                      Text('Storage Usage', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                    ]),
                    const SizedBox(height: 12),
                    ...['database', 'fileStorage', 'backups'].map((key) {
                      final item = storage[key] as Map<String, dynamic>?;
                      if (item == null) return const SizedBox.shrink();
                      final used = (item['used'] as num?)?.toDouble() ?? 0;
                      final limit = (item['limit'] as num?)?.toDouble() ?? 1;
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(key.replaceAllMapped(RegExp(r'([A-Z])'), (m) => ' ${m[1]}').trim(),
                                    style: theme.textTheme.bodySmall),
                                Text('${item['usedFormatted'] ?? '${used.toStringAsFixed(1)} GB'} / ${item['limitFormatted'] ?? '${limit.toStringAsFixed(0)} GB'}',
                                    style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w500)),
                              ],
                            ),
                            const SizedBox(height: 4),
                            LinearProgressIndicator(
                              value: limit > 0 ? (used / limit).clamp(0, 1) : 0,
                              backgroundColor: theme.colorScheme.surfaceContainerHighest,
                            ),
                          ],
                        ),
                      );
                    }),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 12),

          // AI Token Consumption
          if (aiTokens != null)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Icon(Icons.psychology, color: theme.colorScheme.primary),
                      const SizedBox(width: 8),
                      Text('AI Token Usage', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                    ]),
                    const SizedBox(height: 12),
                    ...['emailDrafts', 'callSummaries', 'dealScoring', 'forecasting'].map((key) {
                      final val = aiTokens[key];
                      return _OverviewRow(
                        label: key.replaceAllMapped(RegExp(r'([A-Z])'), (m) => ' ${m[1]}').trim(),
                        value: _fmtNumber(val),
                      );
                    }),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 12),

          // Webhooks
          if (webhooks.isNotEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Icon(Icons.webhook, color: theme.colorScheme.primary),
                      const SizedBox(width: 8),
                      Text('Webhooks', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                    ]),
                    const SizedBox(height: 12),
                    ...webhooks.map((wh) {
                      final active = wh['status'] == 'active' || wh['active'] == true;
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Row(
                          children: [
                            Icon(active ? Icons.check_circle : Icons.pause_circle,
                                size: 14, color: active ? Colors.green : Colors.grey),
                            const SizedBox(width: 8),
                            Expanded(child: Text(wh['event']?.toString() ?? wh['url']?.toString() ?? '',
                                style: theme.textTheme.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis)),
                            Text('${wh['successRate'] ?? '-'}%',
                                style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w500)),
                          ],
                        ),
                      );
                    }),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 12),

          // Background Jobs
          if (jobs.isNotEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Icon(Icons.pending_actions, color: theme.colorScheme.primary),
                      const SizedBox(width: 8),
                      Text('Background Jobs', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                    ]),
                    const SizedBox(height: 12),
                    ...jobs.map((job) {
                      final status = (job['status'] ?? 'idle').toString();
                      final isRunning = status == 'running' || status == 'active';
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Row(
                          children: [
                            Icon(isRunning ? Icons.sync : Icons.check_circle_outline,
                                size: 14, color: isRunning ? Colors.blue : Colors.green),
                            const SizedBox(width: 8),
                            Expanded(child: Text(job['name']?.toString() ?? '',
                                style: theme.textTheme.bodyMedium)),
                            if (job['queue'] != null)
                              Text('${job['queue']} queued', style: theme.textTheme.bodySmall?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant)),
                          ],
                        ),
                      );
                    }),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildResultTable() {
    final columns = List<String>.from(_reportResult!['columns'] ?? []);
    final rows = List<Map<String, dynamic>>.from(_reportResult!['rows'] ?? []);
    if (rows.isEmpty) return const Center(child: Text('No data'));

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: SingleChildScrollView(
        child: DataTable(
          columnSpacing: 20,
          columns: columns.map((c) => DataColumn(
            label: Text(c.replaceAllMapped(RegExp(r'([A-Z])'), (m) => ' ${m[1]}').replaceAll('_', ' ').trim(),
                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12)),
          )).toList(),
          rows: rows.map((row) => DataRow(
            cells: columns.map((c) {
              final val = row[c];
              return DataCell(Text(val?.toString() ?? '-', style: const TextStyle(fontSize: 13)));
            }).toList(),
          )).toList(),
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final String? sub;
  final IconData icon;
  final Color color;

  const _StatCard({required this.label, required this.value, this.sub, required this.icon, required this.color});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Expanded(child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                const SizedBox(height: 4),
                Text(value, style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold)),
                if (sub != null) Text(sub!, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              ],
            )),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: color.withOpacity(0.1), borderRadius: BorderRadius.circular(12)),
              child: Icon(icon, color: color),
            ),
          ],
        ),
      ),
    );
  }
}

class _PlatformStatRow extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String label;
  final String value;

  const _PlatformStatRow({required this.icon, required this.color, required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(icon, size: 16, color: color),
          const SizedBox(width: 8),
          Text(label, style: Theme.of(context).textTheme.bodyMedium),
          const Spacer(),
          Text(value, style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

class _OverviewRow extends StatelessWidget {
  final String label;
  final String value;

  const _OverviewRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          SizedBox(width: 100, child: Text(label,
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant))),
          Expanded(child: Text(value, style: theme.textTheme.bodyMedium)),
        ],
      ),
    );
  }
}

class _RateLimitBar extends StatelessWidget {
  final String label;
  final double used;
  final double limit;

  const _RateLimitBar({required this.label, required this.used, required this.limit});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final pct = limit > 0 ? (used / limit).clamp(0.0, 1.0) : 0.0;
    final color = pct > 0.9 ? Colors.red : pct > 0.7 ? Colors.orange : Colors.green;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: theme.textTheme.bodySmall),
            Text('${used.toInt()} / ${limit.toInt()}',
                style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w500)),
          ],
        ),
        const SizedBox(height: 4),
        LinearProgressIndicator(
          value: pct,
          backgroundColor: theme.colorScheme.surfaceContainerHighest,
          valueColor: AlwaysStoppedAnimation<Color>(color),
        ),
      ],
    );
  }
}
