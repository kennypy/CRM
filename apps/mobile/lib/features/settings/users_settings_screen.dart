import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';

class UsersSettingsScreen extends ConsumerStatefulWidget {
  const UsersSettingsScreen({super.key});

  @override
  ConsumerState<UsersSettingsScreen> createState() => _UsersSettingsScreenState();
}

class _UsersSettingsScreenState extends ConsumerState<UsersSettingsScreen> {
  List<Map<String, dynamic>> _users = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadUsers();
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

  void _showCreateUserDialog() {
    final formKey = GlobalKey<FormState>();
    final firstNameCtl = TextEditingController();
    final lastNameCtl = TextEditingController();
    final emailCtl = TextEditingController();
    final passwordCtl = TextEditingController();
    String role = 'rep';
    bool canQuote = false;
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
    bool submitting = false;

    showModalBottomSheet(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Edit ${user['firstName'] ?? ''} ${user['lastName'] ?? ''}',
                  style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
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

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Users')),
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
              : RefreshIndicator(
                  onRefresh: _loadUsers,
                  child: ListView.separated(
                    itemCount: _users.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final u = _users[index];
                      final name = '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim();
                      final role = (u['role'] ?? 'rep').toString();
                      final roleColor = _roleColor(role);
                      final status = u['status'] ?? 'active';

                      return ListTile(
                        leading: CircleAvatar(
                          backgroundColor: theme.colorScheme.primaryContainer,
                          child: Text(name.isNotEmpty ? name[0].toUpperCase() : '?',
                              style: TextStyle(color: theme.colorScheme.onPrimaryContainer)),
                        ),
                        title: Text(name, style: const TextStyle(fontWeight: FontWeight.w500)),
                        subtitle: Text(u['email'] ?? ''),
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
                              },
                              itemBuilder: (_) => [
                                const PopupMenuItem(value: 'edit', child: Text('Edit')),
                                const PopupMenuItem(value: 'delete',
                                    child: Text('Delete', style: TextStyle(color: Colors.red))),
                              ],
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
