import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';

class UsersSettingsScreen extends ConsumerStatefulWidget {
  const UsersSettingsScreen({super.key});

  @override
  ConsumerState<UsersSettingsScreen> createState() => _UsersSettingsScreenState();
}

class _UsersSettingsScreenState extends ConsumerState<UsersSettingsScreen>
    with SingleTickerProviderStateMixin {
  List<Map<String, dynamic>> _users = [];
  bool _loading = true;
  String? _error;
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadUsers();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadUsers() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.users);
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['users'] ?? []) : []);
      if (mounted) setState(() => _users = List<Map<String, dynamic>>.from(items));
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load users');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Build a list of DropdownMenuItems for the "Reports to" selector,
  /// excluding the user being edited (if any).
  List<DropdownMenuItem<String>> _managerDropdownItems({String? excludeUserId}) {
    final managers = <DropdownMenuItem<String>>[
      const DropdownMenuItem(value: '', child: Text('None')),
    ];
    for (final u in _users) {
      final id = u['id']?.toString() ?? '';
      if (id == excludeUserId) continue;
      final name = '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim();
      managers.add(DropdownMenuItem(value: id, child: Text(name)));
    }
    return managers;
  }

  String _formatLastLogin(dynamic lastLogin) {
    if (lastLogin == null) return 'Never';
    try {
      final dt = DateTime.parse(lastLogin.toString());
      final now = DateTime.now();
      final diff = now.difference(dt);
      if (diff.inMinutes < 1) return 'Just now';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      if (diff.inHours < 24) return '${diff.inHours}h ago';
      if (diff.inDays < 7) return '${diff.inDays}d ago';
      return '${dt.month}/${dt.day}/${dt.year}';
    } catch (_) {
      return lastLogin.toString();
    }
  }

  Future<void> _toggleUserStatus(Map<String, dynamic> user) async {
    final currentStatus = user['status'] ?? 'active';
    final newStatus = currentStatus == 'active' ? 'deactivated' : 'active';
    final action = newStatus == 'active' ? 'activate' : 'deactivate';

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('${action[0].toUpperCase()}${action.substring(1)} User'),
        content: Text('Are you sure you want to $action '
            '${user['firstName'] ?? ''} ${user['lastName'] ?? ''}?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(action[0].toUpperCase() + action.substring(1)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ApiClient.instance.dio.patch('${Endpoints.users}/${user['id']}', data: {
        'status': newStatus,
      });
      _loadUsers();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('User ${newStatus == 'active' ? 'activated' : 'deactivated'}')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to update user status')),
        );
      }
    }
  }

  void _showCreateUserDialog() {
    final formKey = GlobalKey<FormState>();
    final firstNameCtl = TextEditingController();
    final lastNameCtl = TextEditingController();
    final emailCtl = TextEditingController();
    final passwordCtl = TextEditingController();
    String role = 'rep';
    bool canQuote = false;
    String reportsTo = '';
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
                      Expanded(child: Text('Add User',
                          style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold))),
                      IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: firstNameCtl,
                          decoration: const InputDecoration(labelText: 'First name'),
                          validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextFormField(
                          controller: lastNameCtl,
                          decoration: const InputDecoration(labelText: 'Last name'),
                          validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: emailCtl,
                    decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.email_outlined)),
                    keyboardType: TextInputType.emailAddress,
                    validator: (v) {
                      if (v == null || v.trim().isEmpty) return 'Required';
                      if (!v.contains('@')) return 'Invalid email';
                      return null;
                    },
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: passwordCtl,
                    decoration: const InputDecoration(
                      labelText: 'Password',
                      prefixIcon: Icon(Icons.lock_outlined),
                      helperText: '12+ chars, upper/lower, number, special char',
                    ),
                    obscureText: true,
                    validator: (v) {
                      if (v == null || v.length < 12) return 'Min 12 characters';
                      return null;
                    },
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    value: role,
                    decoration: const InputDecoration(labelText: 'Role'),
                    items: const [
                      DropdownMenuItem(value: 'admin', child: Text('Admin')),
                      DropdownMenuItem(value: 'manager', child: Text('Manager')),
                      DropdownMenuItem(value: 'rep', child: Text('Rep')),
                      DropdownMenuItem(value: 'read_only', child: Text('Read Only')),
                    ],
                    onChanged: (v) => setSheetState(() => role = v!),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    value: reportsTo,
                    decoration: const InputDecoration(
                      labelText: 'Reports to',
                      prefixIcon: Icon(Icons.supervisor_account),
                    ),
                    items: _managerDropdownItems(),
                    onChanged: (v) => setSheetState(() => reportsTo = v ?? ''),
                  ),
                  const SizedBox(height: 8),
                  SwitchListTile(
                    title: const Text('Can create quotes'),
                    value: canQuote,
                    onChanged: (v) => setSheetState(() => canQuote = v),
                    contentPadding: EdgeInsets.zero,
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    height: 48,
                    child: ElevatedButton(
                      onPressed: submitting ? null : () async {
                        if (!formKey.currentState!.validate()) return;
                        setSheetState(() => submitting = true);
                        try {
                          await ApiClient.instance.dio.post(Endpoints.users, data: {
                            'firstName': firstNameCtl.text.trim(),
                            'lastName': lastNameCtl.text.trim(),
                            'email': emailCtl.text.trim(),
                            'password': passwordCtl.text,
                            'role': role,
                            'canQuote': canQuote,
                            if (reportsTo.isNotEmpty) 'reportsTo': reportsTo,
                          });
                          if (ctx.mounted) {
                            Navigator.pop(ctx);
                            _loadUsers();
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('User created')),
                            );
                          }
                        } catch (_) {
                          if (ctx.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Failed to create user')),
                            );
                          }
                        } finally {
                          if (ctx.mounted) setSheetState(() => submitting = false);
                        }
                      },
                      child: submitting
                          ? const SizedBox(height: 20, width: 20,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Text('Create User'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _showEditUserDialog(Map<String, dynamic> user) {
    String role = user['role'] ?? 'rep';
    bool canQuote = user['canQuote'] ?? user['can_quote'] ?? false;
    String reportsTo = (user['reportsTo'] ?? user['reports_to'] ?? '').toString();
    bool submitting = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text('Edit ${user['firstName'] ?? ''} ${user['lastName'] ?? ''}',
                          style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                    ),
                    IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
                  ],
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  value: role,
                  decoration: const InputDecoration(labelText: 'Role'),
                  items: const [
                    DropdownMenuItem(value: 'admin', child: Text('Admin')),
                    DropdownMenuItem(value: 'manager', child: Text('Manager')),
                    DropdownMenuItem(value: 'rep', child: Text('Rep')),
                    DropdownMenuItem(value: 'read_only', child: Text('Read Only')),
                  ],
                  onChanged: (v) => setSheetState(() => role = v!),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: _managerDropdownItems(excludeUserId: user['id']?.toString())
                      .any((item) => item.value == reportsTo) ? reportsTo : '',
                  decoration: const InputDecoration(
                    labelText: 'Reports to',
                    prefixIcon: Icon(Icons.supervisor_account),
                  ),
                  items: _managerDropdownItems(excludeUserId: user['id']?.toString()),
                  onChanged: (v) => setSheetState(() => reportsTo = v ?? ''),
                ),
                const SizedBox(height: 8),
                SwitchListTile(
                  title: const Text('Can create quotes'),
                  value: canQuote,
                  onChanged: (v) => setSheetState(() => canQuote = v),
                  contentPadding: EdgeInsets.zero,
                ),
                const SizedBox(height: 16),
                SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: submitting ? null : () async {
                      setSheetState(() => submitting = true);
                      try {
                        await ApiClient.instance.dio.patch('${Endpoints.users}/${user['id']}', data: {
                          'role': role,
                          'canQuote': canQuote,
                          'reportsTo': reportsTo.isEmpty ? null : reportsTo,
                        });
                        if (ctx.mounted) {
                          Navigator.pop(ctx);
                          _loadUsers();
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('User updated')),
                          );
                        }
                      } catch (_) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Failed to update user')),
                          );
                        }
                      } finally {
                        if (ctx.mounted) setSheetState(() => submitting = false);
                      }
                    },
                    child: submitting
                        ? const SizedBox(height: 20, width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Save'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _deleteUser(String id) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete User'),
        content: const Text('Are you sure? This cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ApiClient.instance.dio.delete('${Endpoints.users}/$id');
      _loadUsers();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to delete user')),
        );
      }
    }
  }

  Color _roleColor(String role) {
    switch (role) {
      case 'admin': return Colors.purple;
      case 'super_admin': return Colors.red;
      case 'manager': return Colors.blue;
      case 'read_only': return Colors.grey;
      default: return Colors.green;
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'active': return Colors.green;
      case 'deactivated': return Colors.red;
      case 'invited': return Colors.orange;
      default: return Colors.grey;
    }
  }

  // ── Org tree helpers ──

  /// Build a map of userId -> list of direct reports, then render as a flat
  /// list with indentation to represent hierarchy.
  List<_OrgTreeNode> _buildOrgTree() {
    final Map<String, List<Map<String, dynamic>>> childrenMap = {};
    final Set<String> hasParent = {};

    for (final u in _users) {
      final parentId = (u['reportsTo'] ?? u['reports_to'] ?? '').toString();
      if (parentId.isNotEmpty) {
        childrenMap.putIfAbsent(parentId, () => []);
        childrenMap[parentId]!.add(u);
        hasParent.add(u['id']?.toString() ?? '');
      }
    }

    // Root nodes: users with no parent
    final roots = _users.where((u) => !hasParent.contains(u['id']?.toString() ?? '')).toList();

    final List<_OrgTreeNode> flat = [];

    void walk(Map<String, dynamic> user, int depth) {
      flat.add(_OrgTreeNode(user: user, depth: depth));
      final id = user['id']?.toString() ?? '';
      final children = childrenMap[id];
      if (children != null) {
        for (final child in children) {
          walk(child, depth + 1);
        }
      }
    }

    for (final root in roots) {
      walk(root, 0);
    }

    return flat;
  }

  // ── Build methods ──

  Widget _buildUserList() {
    final theme = Theme.of(context);

    return RefreshIndicator(
      onRefresh: _loadUsers,
      child: ListView.separated(
        itemCount: _users.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (context, index) {
          final u = _users[index];
          final name = '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim();
          final role = (u['role'] ?? 'rep').toString();
          final roleColor = _roleColor(role);
          final status = (u['status'] ?? 'active').toString();
          final lastLogin = u['lastLogin'] ?? u['last_login'];

          return ListTile(
            leading: Stack(
              children: [
                CircleAvatar(
                  backgroundColor: theme.colorScheme.primaryContainer,
                  child: Text(name.isNotEmpty ? name[0].toUpperCase() : '?',
                      style: TextStyle(color: theme.colorScheme.onPrimaryContainer)),
                ),
                Positioned(
                  bottom: 0,
                  right: 0,
                  child: Container(
                    width: 12,
                    height: 12,
                    decoration: BoxDecoration(
                      color: _statusColor(status),
                      shape: BoxShape.circle,
                      border: Border.all(color: theme.scaffoldBackgroundColor, width: 2),
                    ),
                  ),
                ),
              ],
            ),
            title: Text(name, style: const TextStyle(fontWeight: FontWeight.w500)),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(u['email'] ?? ''),
                const SizedBox(height: 2),
                Text(
                  'Last login: ${_formatLastLogin(lastLogin)}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
            isThreeLine: true,
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: roleColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(role.replaceAll('_', ' '),
                      style: TextStyle(fontSize: 11, color: roleColor, fontWeight: FontWeight.w600)),
                ),
                if (status == 'invited')
                  Padding(
                    padding: const EdgeInsets.only(left: 4),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: Colors.orange.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: const Text('invited',
                          style: TextStyle(fontSize: 10, color: Colors.orange)),
                    ),
                  ),
                PopupMenuButton<String>(
                  onSelected: (v) {
                    if (v == 'edit') _showEditUserDialog(u);
                    if (v == 'delete') _deleteUser(u['id']);
                    if (v == 'toggle_status') _toggleUserStatus(u);
                  },
                  itemBuilder: (_) => [
                    const PopupMenuItem(value: 'edit', child: Text('Edit')),
                    PopupMenuItem(
                      value: 'toggle_status',
                      child: Text(
                        status == 'active' ? 'Deactivate' : 'Activate',
                        style: TextStyle(
                          color: status == 'active' ? Colors.orange : Colors.green,
                        ),
                      ),
                    ),
                    const PopupMenuItem(value: 'delete',
                        child: Text('Delete', style: TextStyle(color: Colors.red))),
                  ],
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildOrgTreeView() {
    final theme = Theme.of(context);
    final nodes = _buildOrgTree();

    if (nodes.isEmpty) {
      return const Center(child: Text('No users found'));
    }

    return RefreshIndicator(
      onRefresh: _loadUsers,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: nodes.length,
        itemBuilder: (context, index) {
          final node = nodes[index];
          final u = node.user;
          final name = '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim();
          final role = (u['role'] ?? 'rep').toString();
          final roleColor = _roleColor(role);
          final status = (u['status'] ?? 'active').toString();

          return Padding(
            padding: EdgeInsets.only(left: node.depth * 24.0),
            child: Card(
              margin: const EdgeInsets.symmetric(vertical: 4),
              child: ListTile(
                leading: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (node.depth > 0)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: Icon(Icons.subdirectory_arrow_right,
                            size: 18, color: theme.colorScheme.onSurfaceVariant),
                      ),
                    Stack(
                      children: [
                        CircleAvatar(
                          radius: 18,
                          backgroundColor: theme.colorScheme.primaryContainer,
                          child: Text(name.isNotEmpty ? name[0].toUpperCase() : '?',
                              style: TextStyle(
                                  fontSize: 14,
                                  color: theme.colorScheme.onPrimaryContainer)),
                        ),
                        Positioned(
                          bottom: 0,
                          right: 0,
                          child: Container(
                            width: 10,
                            height: 10,
                            decoration: BoxDecoration(
                              color: _statusColor(status),
                              shape: BoxShape.circle,
                              border: Border.all(color: theme.cardColor, width: 1.5),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                title: Text(name, style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 14)),
                subtitle: Text(u['email'] ?? '', style: const TextStyle(fontSize: 12)),
                trailing: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: roleColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(role.replaceAll('_', ' '),
                      style: TextStyle(fontSize: 11, color: roleColor, fontWeight: FontWeight.w600)),
                ),
                onTap: () => _showEditUserDialog(u),
              ),
            ),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Users'),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(icon: Icon(Icons.people), text: 'Users'),
            Tab(icon: Icon(Icons.account_tree), text: 'Org Tree'),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _showCreateUserDialog,
        child: const Icon(Icons.person_add),
      ),
      body: _error != null
          ? Center(child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(_error!, style: theme.textTheme.bodyMedium),
                const SizedBox(height: 8),
                ElevatedButton(onPressed: _loadUsers, child: const Text('Retry')),
              ],
            ))
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : TabBarView(
                  controller: _tabController,
                  children: [
                    _buildUserList(),
                    _buildOrgTreeView(),
                  ],
                ),
    );
  }
}

class _OrgTreeNode {
  final Map<String, dynamic> user;
  final int depth;

  const _OrgTreeNode({required this.user, required this.depth});
}
