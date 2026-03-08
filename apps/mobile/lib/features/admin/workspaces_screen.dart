import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../core/auth/auth_provider.dart';
import '../../core/auth/auth_service.dart';
import '../../shared/widgets/error_view.dart';
import '../../shared/widgets/empty_state.dart';

class WorkspacesScreen extends ConsumerStatefulWidget {
  const WorkspacesScreen({super.key});

  @override
  ConsumerState<WorkspacesScreen> createState() => _WorkspacesScreenState();
}

class _WorkspacesScreenState extends ConsumerState<WorkspacesScreen> {
  List<Map<String, dynamic>> _workspaces = [];
  bool _loading = true;
  String? _error;
  String _search = '';
  String _planFilter = 'all';
  final _searchController = TextEditingController();

  // Pagination
  int _currentPage = 1;
  static const int _pageSize = 25;
  int _total = 0;
  int get _totalPages => (_total / _pageSize).ceil().clamp(1, 9999);

  static const List<_PlanFilterOption> _planOptions = [
    _PlanFilterOption('all', 'All'),
    _PlanFilterOption('enterprise', 'Enterprise'),
    _PlanFilterOption('professional', 'Professional'),
    _PlanFilterOption('growth', 'Growth'),
    _PlanFilterOption('starter', 'Starter'),
    _PlanFilterOption('free', 'Free'),
  ];

  static const Map<String, Color> _planColors = {
    'enterprise': Colors.purple,
    'professional': Colors.blue,
    'growth': Colors.teal,
    'starter': Colors.orange,
    'free': Colors.grey,
  };

  @override
  void initState() {
    super.initState();
    _loadWorkspaces();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  static List<Map<String, dynamic>> get _demoWorkspaces => [
    {'id': 'ws-1', 'name': 'Acme Corporation', 'slug': 'acme-corp', 'plan': 'enterprise', 'dataRegion': 'us-east',
     'userCount': 48, 'childCount': 3, 'parentTenantId': null, 'status': 'active', 'createdAt': '2024-06-15T10:30:00Z'},
    {'id': 'ws-1a', 'name': 'Acme EMEA', 'slug': 'acme-emea', 'plan': 'enterprise', 'dataRegion': 'eu-west',
     'userCount': 12, 'childCount': 0, 'parentTenantId': 'ws-1', 'status': 'active', 'createdAt': '2024-08-01T08:00:00Z'},
    {'id': 'ws-1b', 'name': 'Acme APAC', 'slug': 'acme-apac', 'plan': 'professional', 'dataRegion': 'ap-southeast',
     'userCount': 8, 'childCount': 0, 'parentTenantId': 'ws-1', 'status': 'active', 'createdAt': '2024-09-12T14:00:00Z'},
    {'id': 'ws-1c', 'name': 'Acme Latam', 'slug': 'acme-latam', 'plan': 'starter', 'dataRegion': 'us-east',
     'userCount': 4, 'childCount': 0, 'parentTenantId': 'ws-1', 'status': 'suspended', 'createdAt': '2025-01-20T09:00:00Z'},
    {'id': 'ws-2', 'name': 'Globex Inc', 'slug': 'globex', 'plan': 'professional', 'dataRegion': 'us-west',
     'userCount': 22, 'childCount': 1, 'parentTenantId': null, 'status': 'active', 'createdAt': '2024-10-03T12:45:00Z'},
    {'id': 'ws-2a', 'name': 'Globex UK', 'slug': 'globex-uk', 'plan': 'professional', 'dataRegion': 'eu-west',
     'userCount': 6, 'childCount': 0, 'parentTenantId': 'ws-2', 'status': 'active', 'createdAt': '2025-02-10T11:30:00Z'},
    {'id': 'ws-3', 'name': 'Initech', 'slug': 'initech', 'plan': 'starter', 'dataRegion': 'us-east',
     'userCount': 5, 'childCount': 0, 'parentTenantId': null, 'status': 'active', 'createdAt': '2025-03-01T16:00:00Z'},
    {'id': 'ws-4', 'name': 'Umbrella Corp', 'slug': 'umbrella', 'plan': 'free', 'dataRegion': 'us-east',
     'userCount': 2, 'childCount': 0, 'parentTenantId': null, 'status': 'suspended', 'createdAt': '2025-02-14T08:20:00Z'},
  ];

  Future<void> _loadWorkspaces() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.adminTenants);
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? []) : []);
      if (mounted) {
        setState(() {
          _workspaces = List<Map<String, dynamic>>.from(items);
          _total = _workspaces.length;
        });
      }
    } catch (e) {
      // Demo data fallback when API is unreachable
      if (mounted) {
        setState(() {
          _workspaces = List<Map<String, dynamic>>.from(_demoWorkspaces);
          _total = _workspaces.length;
        });
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<MapEntry<Map<String, dynamic>, int>> _getOrderedWorkspaces() {
    var filtered = _workspaces.where((w) {
      if (_planFilter != 'all' && (w['plan'] ?? '').toString().toLowerCase() != _planFilter) return false;
      if (_search.isNotEmpty) {
        final s = _search.toLowerCase();
        return (w['name'] ?? '').toString().toLowerCase().contains(s) ||
            (w['slug'] ?? '').toString().toLowerCase().contains(s);
      }
      return true;
    }).toList();

    if (_search.isNotEmpty) {
      return filtered.map((w) => MapEntry(w, 0)).toList();
    }

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

    // Orphan children
    for (final w in filtered) {
      if (w['parentTenantId'] != null && !ordered.any((e) => e.key['id'] == w['id'])) {
        ordered.add(MapEntry(w, 1));
      }
    }

    return ordered;
  }

  void _goToPage(int page) {
    if (page < 1 || page > _totalPages || page == _currentPage) return;
    setState(() => _currentPage = page);
  }

  String _formatDate(String? date) {
    if (date == null || date.isEmpty) return '-';
    try {
      final dt = DateTime.parse(date);
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return date;
    }
  }

  void _showWorkspaceDetail(Map<String, dynamic> workspace) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _WorkspaceDetailView(
          workspaceId: workspace['id'].toString(),
          onRefresh: _loadWorkspaces,
        ),
      ),
    );
  }

  void _showCreateWorkspaceDialog({String? parentId, String? parentName}) {
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
                      Expanded(child: Text(
                        parentId != null ? 'Create Sub-Workspace' : 'Create Workspace',
                        style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                      )),
                      IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
                    ],
                  ),
                  if (parentId != null && parentName != null) ...[
                    const SizedBox(height: 4),
                    Text('Under: $parentName',
                        style: Theme.of(ctx).textTheme.bodySmall?.copyWith(
                            color: Theme.of(ctx).colorScheme.onSurfaceVariant)),
                  ],
                  const SizedBox(height: 12),
                  Text('Organisation', style: Theme.of(ctx).textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  TextFormField(
                    controller: nameCtl,
                    decoration: const InputDecoration(labelText: 'Workspace name', prefixIcon: Icon(Icons.business)),
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
                  if (parentId == null) ...[
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
                  ],
                  const SizedBox(height: 20),
                  SizedBox(height: 48, child: ElevatedButton(
                    onPressed: submitting ? null : () async {
                      if (!formKey.currentState!.validate()) return;
                      setSheetState(() => submitting = true);
                      try {
                        if (parentId != null) {
                          // Create sub-workspace
                          await ApiClient.instance.dio.post(
                            '${Endpoints.adminTenants}/${parentId}/children',
                            data: {
                              'name': nameCtl.text.trim(),
                              'slug': slugCtl.text.trim(),
                            },
                          );
                        } else {
                          await AuthService.instance.register(
                            tenantName: nameCtl.text.trim(), tenantSlug: slugCtl.text.trim(),
                            firstName: firstNameCtl.text.trim(), lastName: lastNameCtl.text.trim(),
                            email: emailCtl.text.trim(), password: passwordCtl.text,
                          );
                        }
                        if (ctx.mounted) {
                          Navigator.pop(ctx);
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text(parentId != null ? 'Sub-workspace created' : 'Workspace created successfully')),
                          );
                          _loadWorkspaces();
                        }
                      } catch (e) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('Failed to create ${parentId != null ? 'sub-workspace' : 'workspace'}')),
                          );
                        }
                      } finally {
                        if (ctx.mounted) setSheetState(() => submitting = false);
                      }
                    },
                    child: submitting
                        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : Text(parentId != null ? 'Create Sub-Workspace' : 'Create Workspace'),
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
    final ordered = _getOrderedWorkspaces();

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Workspaces'),
            if (!_loading)
              Text('${_workspaces.length} workspace${_workspaces.length != 1 ? 's' : ''}',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ],
        ),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadWorkspaces),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(96),
          child: Column(
            children: [
              // Search bar
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: TextField(
                  controller: _searchController,
                  decoration: InputDecoration(
                    hintText: 'Search workspaces...',
                    prefixIcon: const Icon(Icons.search, size: 20),
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(vertical: 10),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                    suffixIcon: _search.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear, size: 18),
                            onPressed: () {
                              _searchController.clear();
                              setState(() { _search = ''; _currentPage = 1; });
                            },
                          )
                        : null,
                  ),
                  onChanged: (v) => setState(() { _search = v; _currentPage = 1; }),
                ),
              ),
              // Plan filter chips
              SizedBox(
                height: 40,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: _planOptions.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 6),
                  itemBuilder: (context, index) {
                    final option = _planOptions[index];
                    final isSelected = _planFilter == option.value;
                    final chipColor = _planColors[option.value] ?? theme.colorScheme.primary;
                    return FilterChip(
                      label: Text(option.label),
                      selected: isSelected,
                      onSelected: (_) => setState(() { _planFilter = option.value; _currentPage = 1; }),
                      selectedColor: chipColor.withOpacity(0.2),
                      checkmarkColor: chipColor,
                      labelStyle: TextStyle(
                        fontSize: 12,
                        fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                        color: isSelected ? chipColor : null,
                      ),
                      visualDensity: VisualDensity.compact,
                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                    );
                  },
                ),
              ),
              const SizedBox(height: 4),
            ],
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showCreateWorkspaceDialog(),
        icon: const Icon(Icons.add),
        label: const Text('New Workspace'),
      ),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadWorkspaces)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : ordered.isEmpty
                  ? EmptyState(
                      icon: Icons.business,
                      title: _search.isNotEmpty || _planFilter != 'all'
                          ? 'No workspaces match your filters'
                          : 'No workspaces yet',
                    )
                  : Column(
                      children: [
                        Expanded(
                          child: RefreshIndicator(
                            onRefresh: _loadWorkspaces,
                            child: ListView.separated(
                              itemCount: ordered.length,
                              separatorBuilder: (_, __) => const Divider(height: 1),
                              itemBuilder: (context, index) {
                                final w = ordered[index].key;
                                final depth = ordered[index].value;
                                return _buildWorkspaceTile(theme, w, depth);
                              },
                            ),
                          ),
                        ),
                        if (_total > _pageSize) _buildPaginationBar(theme),
                      ],
                    ),
    );
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'active': return Colors.green;
      case 'suspended': return Colors.red;
      default: return Colors.grey;
    }
  }

  Widget _buildWorkspaceTile(ThemeData theme, Map<String, dynamic> w, int depth) {
    final plan = (w['plan'] ?? 'starter').toString().toLowerCase();
    final planColor = _planColors[plan] ?? Colors.grey;
    final status = (w['status'] ?? 'active').toString().toLowerCase();
    final statusColor = _statusColor(status);
    final childCount = w['childCount'] ?? 0;
    final userCount = w['userCount'] ?? w['user_count'] ?? 0;
    final createdAt = w['createdAt'] ?? w['created_at'] ?? '';

    return ListTile(
      contentPadding: EdgeInsets.only(left: 16.0 + depth * 28, right: 16),
      leading: depth > 0
          ? Icon(Icons.subdirectory_arrow_right, size: 16, color: theme.colorScheme.onSurfaceVariant)
          : CircleAvatar(
              radius: 18,
              backgroundColor: theme.colorScheme.surfaceContainerHighest,
              child: Icon(Icons.business, size: 18, color: theme.colorScheme.onSurfaceVariant),
            ),
      title: Row(
        children: [
          // Status dot (green=active, red=suspended)
          Container(
            width: 8,
            height: 8,
            margin: const EdgeInsets.only(right: 6),
            decoration: BoxDecoration(color: statusColor, shape: BoxShape.circle),
          ),
          Expanded(
            child: Text(w['name'] ?? '', style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 14),
                maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
          Container(
            margin: const EdgeInsets.only(left: 6),
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
            decoration: BoxDecoration(
              color: statusColor.withOpacity(0.1),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(status,
                style: TextStyle(fontSize: 10, color: statusColor, fontWeight: FontWeight.w500)),
          ),
        ],
      ),
      subtitle: Text.rich(TextSpan(children: [
        TextSpan(text: w['slug'] ?? ''),
        if (w['dataRegion'] != null)
          TextSpan(text: ' \u00b7 ${(w['dataRegion'] ?? '').toString().toUpperCase()}'),
        if (childCount > 0)
          TextSpan(
            text: ' \u00b7 $childCount sub',
            style: TextStyle(color: theme.colorScheme.primary),
          ),
        TextSpan(text: ' \u00b7 ${_formatDate(createdAt)}'),
      ]), style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('$userCount users', style: theme.textTheme.bodySmall),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: planColor.withOpacity(0.1),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(plan,
                style: TextStyle(fontSize: 11, color: planColor, fontWeight: FontWeight.w500)),
          ),
        ],
      ),
      onTap: () => _showWorkspaceDetail(w),
    );
  }

  Widget _buildPaginationBar(ThemeData theme) {
    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(top: BorderSide(color: theme.colorScheme.outlineVariant)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          IconButton(
            icon: const Icon(Icons.chevron_left),
            onPressed: _currentPage > 1 ? () => _goToPage(_currentPage - 1) : null,
            visualDensity: VisualDensity.compact,
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: theme.colorScheme.primaryContainer,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Text(
              'Page $_currentPage of $_totalPages',
              style: theme.textTheme.labelMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                  color: theme.colorScheme.onPrimaryContainer),
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            icon: const Icon(Icons.chevron_right),
            onPressed: _currentPage < _totalPages ? () => _goToPage(_currentPage + 1) : null,
            visualDensity: VisualDensity.compact,
          ),
        ],
      ),
    );
  }
}

class _PlanFilterOption {
  final String value;
  final String label;
  const _PlanFilterOption(this.value, this.label);
}

/// Workspace detail view pushed as a full page
class _WorkspaceDetailView extends StatefulWidget {
  final String workspaceId;
  final VoidCallback onRefresh;

  const _WorkspaceDetailView({required this.workspaceId, required this.onRefresh});

  @override
  State<_WorkspaceDetailView> createState() => _WorkspaceDetailViewState();
}

class _WorkspaceDetailViewState extends State<_WorkspaceDetailView> {
  Map<String, dynamic>? _workspace;
  List<Map<String, dynamic>> _users = [];
  Map<String, dynamic>? _stats;
  bool _loading = true;

  static const Map<String, Color> _planColors = {
    'enterprise': Colors.purple,
    'professional': Colors.blue,
    'growth': Colors.teal,
    'starter': Colors.orange,
    'free': Colors.grey,
  };

  @override
  void initState() {
    super.initState();
    _loadAll();
  }

  static const Map<String, dynamic> _demoStats = {
    'current': {
      'apiCalls': 52340,
      'aiEvents': 1280,
      'emailsSent': 8920,
      'callsMade': 435,
      'storageBytes': 2147483648,
    },
  };

  static const List<Map<String, dynamic>> _demoUsers = [
    {'id': 'u1', 'email': 'admin@example.com', 'firstName': 'Jane', 'lastName': 'Smith', 'role': 'admin'},
    {'id': 'u2', 'email': 'john@example.com', 'firstName': 'John', 'lastName': 'Doe', 'role': 'rep'},
    {'id': 'u3', 'email': 'sara@example.com', 'firstName': 'Sara', 'lastName': 'Lee', 'role': 'manager'},
  ];

  Future<void> _loadAll() async {
    setState(() => _loading = true);
    await Future.wait([_loadWorkspace(), _loadUsers(), _loadStats()]);
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _loadWorkspace() async {
    try {
      final res = await ApiClient.instance.dio.get('${Endpoints.adminTenants}/${widget.workspaceId}');
      if (mounted) setState(() => _workspace = res.data['data']);
    } catch (_) {
      // Demo fallback: keep workspace data passed from list if available
    }
  }

  Future<void> _loadUsers() async {
    try {
      final res = await ApiClient.instance.dio.get('${Endpoints.adminTenants}/${widget.workspaceId}/users');
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['users'] ?? []) : []);
      if (mounted) setState(() => _users = List<Map<String, dynamic>>.from(items));
    } catch (_) {
      // Demo data fallback
      if (mounted) setState(() => _users = List<Map<String, dynamic>>.from(_demoUsers));
    }
  }

  Future<void> _loadStats() async {
    try {
      final res = await ApiClient.instance.dio.get('${Endpoints.adminTenants}/${widget.workspaceId}/stats');
      if (mounted) setState(() => _stats = res.data['data']);
    } catch (_) {
      // Demo data fallback
      if (mounted) setState(() => _stats = Map<String, dynamic>.from(_demoStats));
    }
  }

  String _formatDate(String? date) {
    if (date == null || date.isEmpty) return '-';
    try {
      final dt = DateTime.parse(date);
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return date;
    }
  }

  String _fmtNumber(dynamic n) {
    if (n == null) return '0';
    final v = n is num ? n : num.tryParse(n.toString()) ?? 0;
    if (v >= 1000000) return '${(v / 1000000).toStringAsFixed(1)}M';
    if (v >= 1000) return '${(v / 1000).toStringAsFixed(1)}K';
    return v.toString();
  }

  void _showCreateSubWorkspaceDialog() {
    final formKey = GlobalKey<FormState>();
    final nameCtl = TextEditingController();
    final slugCtl = TextEditingController();
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
                      Expanded(child: Text('Create Sub-Workspace',
                          style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold))),
                      IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text('Under: ${_workspace?['name'] ?? ''}',
                      style: Theme.of(ctx).textTheme.bodySmall?.copyWith(
                          color: Theme.of(ctx).colorScheme.onSurfaceVariant)),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: nameCtl,
                    decoration: const InputDecoration(labelText: 'Name', prefixIcon: Icon(Icons.business)),
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
                    decoration: const InputDecoration(labelText: 'URL slug', hintText: 'my-sub-workspace', prefixIcon: Icon(Icons.link)),
                    textInputAction: TextInputAction.done,
                    autocorrect: false,
                    validator: (v) {
                      if (v == null || v.trim().length < 2) return 'Min 2 characters';
                      if (!RegExp(r'^[a-z0-9-]+$').hasMatch(v)) return 'Lowercase letters, numbers, hyphens only';
                      return null;
                    },
                  ),
                  const SizedBox(height: 20),
                  SizedBox(height: 48, child: ElevatedButton(
                    onPressed: submitting ? null : () async {
                      if (!formKey.currentState!.validate()) return;
                      setSheetState(() => submitting = true);
                      try {
                        await ApiClient.instance.dio.post(
                          '${Endpoints.adminTenants}/${widget.workspaceId}/children',
                          data: { 'name': nameCtl.text.trim(), 'slug': slugCtl.text.trim() },
                        );
                        if (ctx.mounted) {
                          Navigator.pop(ctx);
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Sub-workspace created')),
                          );
                          _loadAll();
                          widget.onRefresh();
                        }
                      } catch (e) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Failed to create sub-workspace')),
                          );
                        }
                      } finally {
                        if (ctx.mounted) setSheetState(() => submitting = false);
                      }
                    },
                    child: submitting
                        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Create Sub-Workspace'),
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

    return Scaffold(
      appBar: AppBar(
        title: Text(_workspace?['name'] ?? 'Workspace'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadAll),
        ],
      ),
      floatingActionButton: FloatingActionButton.small(
        onPressed: _showCreateSubWorkspaceDialog,
        tooltip: 'New Sub-Workspace',
        child: const Icon(Icons.add),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _workspace == null
              ? const ErrorView(message: 'Workspace not found')
              : RefreshIndicator(
                  onRefresh: _loadAll,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      // Workspace info
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Icon(Icons.business, color: theme.colorScheme.primary),
                                  const SizedBox(width: 8),
                                  Expanded(child: Text('Workspace Info',
                                      style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600))),
                                  _buildPlanBadge(theme, (_workspace!['plan'] ?? 'starter').toString()),
                                ],
                              ),
                              const SizedBox(height: 12),
                              _InfoRow(label: 'Name', value: _workspace!['name'] ?? '-'),
                              _InfoRow(label: 'Slug', value: _workspace!['slug'] ?? '-'),
                              _InfoRow(label: 'Region', value: (_workspace!['dataRegion'] ?? '-').toString().toUpperCase()),
                              _StatusRow(status: (_workspace!['status'] ?? 'active').toString()),
                              _InfoRow(label: 'Created', value: _formatDate(_workspace!['createdAt'] ?? _workspace!['created_at'])),
                              if (_workspace!['parentName'] != null)
                                _InfoRow(label: 'Parent', value: _workspace!['parentName']),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),

                      // Usage stats
                      if (_stats != null) ...[
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Icon(Icons.analytics, color: theme.colorScheme.primary),
                                    const SizedBox(width: 8),
                                    Text('Usage Stats',
                                        style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                                  ],
                                ),
                                const SizedBox(height: 12),
                                _buildStatsGrid(theme),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],

                      // Sub-workspaces
                      _buildChildrenSection(theme),
                      const SizedBox(height: 12),

                      // Users
                      _buildUsersSection(theme),
                    ],
                  ),
                ),
    );
  }

  Widget _buildPlanBadge(ThemeData theme, String plan) {
    final color = _planColors[plan.toLowerCase()] ?? Colors.grey;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(plan.toUpperCase(),
          style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.bold)),
    );
  }

  Widget _buildStatsGrid(ThemeData theme) {
    final current = _stats!['current'] as Map<String, dynamic>? ?? _stats!;
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        _StatChip(label: 'API Calls', value: _fmtNumber(current['apiCalls'] ?? current['api_calls']), color: Colors.blue),
        _StatChip(label: 'AI Events', value: _fmtNumber(current['aiEvents'] ?? current['ai_events']), color: Colors.purple),
        _StatChip(label: 'Emails', value: _fmtNumber(current['emailsSent'] ?? current['emails_sent']), color: Colors.green),
        _StatChip(label: 'Calls', value: _fmtNumber(current['callsMade'] ?? current['calls_made']), color: Colors.orange),
        _StatChip(label: 'Storage', value: _fmtBytes(current['storageBytes'] ?? current['storage_bytes']), color: Colors.teal),
      ],
    );
  }

  String _fmtBytes(dynamic n) {
    if (n == null) return '0 B';
    final v = n is num ? n.toDouble() : double.tryParse(n.toString()) ?? 0;
    if (v >= 1073741824) return '${(v / 1073741824).toStringAsFixed(1)} GB';
    if (v >= 1048576) return '${(v / 1048576).toStringAsFixed(1)} MB';
    if (v >= 1024) return '${(v / 1024).toStringAsFixed(1)} KB';
    return '${v.toInt()} B';
  }

  Widget _buildChildrenSection(ThemeData theme) {
    final children = _workspace!['children'] as List? ?? [];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.account_tree, size: 18, color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: 8),
                Text('Sub-Workspaces (${children.length})',
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                const Spacer(),
                TextButton.icon(
                  onPressed: _showCreateSubWorkspaceDialog,
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('Add'),
                  style: TextButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    textStyle: const TextStyle(fontSize: 12),
                  ),
                ),
              ],
            ),
            if (children.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text('No sub-workspaces yet.',
                    style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              )
            else
              ...children.map((c) {
                final child = c is Map<String, dynamic> ? c : <String, dynamic>{};
                final cPlan = (child['plan'] ?? 'starter').toString().toLowerCase();
                final cPlanColor = _planColors[cPlan] ?? Colors.grey;
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: Icon(Icons.subdirectory_arrow_right, size: 16,
                      color: theme.colorScheme.onSurfaceVariant),
                  title: Text(child['name'] ?? '', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
                  subtitle: Text(child['slug'] ?? '',
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('${child['userCount'] ?? 0} users', style: theme.textTheme.bodySmall),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: cPlanColor.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(cPlan, style: TextStyle(fontSize: 10, color: cPlanColor, fontWeight: FontWeight.w500)),
                      ),
                    ],
                  ),
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => _WorkspaceDetailView(
                          workspaceId: child['id'].toString(),
                          onRefresh: widget.onRefresh,
                        ),
                      ),
                    );
                  },
                );
              }),
          ],
        ),
      ),
    );
  }

  Widget _buildUsersSection(ThemeData theme) {
    const roleColors = {
      'admin': Colors.purple,
      'super_admin': Colors.red,
      'manager': Colors.blue,
      'read_only': Colors.grey,
      'rep': Colors.green,
    };

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.people, size: 18, color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: 8),
                Text('Users (${_users.length})',
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
              ],
            ),
            const SizedBox(height: 8),
            if (_users.isEmpty)
              Text('No users in this workspace.',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant))
            else
              ..._users.map((u) {
                final name = u['fullName'] ?? '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim();
                final email = u['email'] ?? '';
                final role = (u['role'] ?? 'rep').toString();
                final roleColor = roleColors[role] ?? Colors.grey;

                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: CircleAvatar(
                    radius: 14,
                    backgroundColor: theme.colorScheme.primaryContainer,
                    child: Text(name.isNotEmpty ? name[0].toUpperCase() : '?',
                        style: TextStyle(fontSize: 11, color: theme.colorScheme.onPrimaryContainer)),
                  ),
                  title: Text(name, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
                  subtitle: Text(email, style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant)),
                  trailing: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                    decoration: BoxDecoration(
                      color: roleColor.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(role.replaceAll('_', ' '),
                        style: TextStyle(fontSize: 10, color: roleColor, fontWeight: FontWeight.w500)),
                  ),
                );
              }),
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

class _StatusRow extends StatelessWidget {
  final String status;

  const _StatusRow({required this.status});

  Color _statusColor() {
    switch (status.toLowerCase()) {
      case 'active': return Colors.green;
      case 'suspended': return Colors.red;
      default: return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = _statusColor();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          SizedBox(width: 100, child: Text('Status',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant))),
          Container(
            width: 8, height: 8,
            margin: const EdgeInsets.only(right: 6),
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          Text(status[0].toUpperCase() + status.substring(1),
              style: TextStyle(fontSize: 14, color: color, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

class _StatChip extends StatelessWidget {
  final String label;
  final String value;
  final Color color;

  const _StatChip({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: color.withOpacity(0.06),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withOpacity(0.15)),
      ),
      child: Column(
        children: [
          Text(value, style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: color)),
          const SizedBox(height: 2),
          Text(label, style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant, fontSize: 10)),
        ],
      ),
    );
  }
}
