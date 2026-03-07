import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';

class SecuritySettingsScreen extends ConsumerStatefulWidget {
  const SecuritySettingsScreen({super.key});

  @override
  ConsumerState<SecuritySettingsScreen> createState() => _SecuritySettingsScreenState();
}

class _SecuritySettingsScreenState extends ConsumerState<SecuritySettingsScreen> {
  final _currentPasswordCtl = TextEditingController();
  final _newPasswordCtl = TextEditingController();
  final _confirmPasswordCtl = TextEditingController();
  bool _changingPassword = false;
  bool _obscureCurrent = true;
  bool _obscureNew = true;
  bool _obscureConfirm = true;

  // API Keys
  List<Map<String, dynamic>> _apiKeys = [];
  bool _loadingKeys = true;

  @override
  void initState() {
    super.initState();
    _loadApiKeys();
  }

  @override
  void dispose() {
    _currentPasswordCtl.dispose();
    _newPasswordCtl.dispose();
    _confirmPasswordCtl.dispose();
    super.dispose();
  }

  Future<void> _loadApiKeys() async {
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.apiKeys);
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? []) : []);
      if (mounted) setState(() => _apiKeys = List<Map<String, dynamic>>.from(items));
    } catch (_) {}
    finally { if (mounted) setState(() => _loadingKeys = false); }
  }

  Future<void> _changePassword() async {
    if (_newPasswordCtl.text != _confirmPasswordCtl.text) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Passwords do not match')),
      );
      return;
    }
    if (_newPasswordCtl.text.length < 12) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Password must be at least 12 characters')),
      );
      return;
    }
    setState(() => _changingPassword = true);
    try {
      await ApiClient.instance.dio.post('${Endpoints.apiUrl}/auth/change-password', data: {
        'currentPassword': _currentPasswordCtl.text,
        'newPassword': _newPasswordCtl.text,
      });
      if (mounted) {
        _currentPasswordCtl.clear();
        _newPasswordCtl.clear();
        _confirmPasswordCtl.clear();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Password changed successfully')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to change password')),
        );
      }
    } finally {
      if (mounted) setState(() => _changingPassword = false);
    }
  }

  Future<void> _createApiKey() async {
    final nameCtl = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Create API Key'),
        content: TextField(
          controller: nameCtl,
          decoration: const InputDecoration(labelText: 'Key name', hintText: 'e.g. Mobile App'),
          autofocus: true,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, nameCtl.text), child: const Text('Create')),
        ],
      ),
    );
    if (result == null || result.trim().isEmpty) return;

    try {
      final res = await ApiClient.instance.dio.post(Endpoints.apiKeys, data: {'name': result.trim()});
      final key = res.data['data']?['key'] ?? res.data['data']?['token'] ?? '';
      if (mounted) {
        _loadApiKeys();
        if (key.isNotEmpty) {
          showDialog(
            context: context,
            builder: (ctx) => AlertDialog(
              title: const Text('API Key Created'),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('Copy this key now. It won\'t be shown again.'),
                  const SizedBox(height: 12),
                  SelectableText(key, style: const TextStyle(fontFamily: 'monospace', fontSize: 13)),
                ],
              ),
              actions: [
                TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Done')),
              ],
            ),
          );
        }
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to create API key')),
        );
      }
    }
  }

  Future<void> _deleteApiKey(String id) async {
    try {
      await ApiClient.instance.dio.delete('${Endpoints.apiKeys}/$id');
      _loadApiKeys();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to delete API key')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Security')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Change Password
          Text('Change Password',
              style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 12),
          TextField(
            controller: _currentPasswordCtl,
            decoration: InputDecoration(
              labelText: 'Current password',
              border: const OutlineInputBorder(),
              suffixIcon: IconButton(
                icon: Icon(_obscureCurrent ? Icons.visibility_off : Icons.visibility, size: 20),
                onPressed: () => setState(() => _obscureCurrent = !_obscureCurrent),
              ),
            ),
            obscureText: _obscureCurrent,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _newPasswordCtl,
            decoration: InputDecoration(
              labelText: 'New password',
              helperText: '12+ chars, upper/lower, number, special char',
              helperMaxLines: 2,
              border: const OutlineInputBorder(),
              suffixIcon: IconButton(
                icon: Icon(_obscureNew ? Icons.visibility_off : Icons.visibility, size: 20),
                onPressed: () => setState(() => _obscureNew = !_obscureNew),
              ),
            ),
            obscureText: _obscureNew,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _confirmPasswordCtl,
            decoration: InputDecoration(
              labelText: 'Confirm new password',
              border: const OutlineInputBorder(),
              suffixIcon: IconButton(
                icon: Icon(_obscureConfirm ? Icons.visibility_off : Icons.visibility, size: 20),
                onPressed: () => setState(() => _obscureConfirm = !_obscureConfirm),
              ),
            ),
            obscureText: _obscureConfirm,
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 44,
            child: ElevatedButton(
              onPressed: _changingPassword ? null : _changePassword,
              child: _changingPassword
                  ? const SizedBox(height: 18, width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Change Password'),
            ),
          ),

          const SizedBox(height: 32),
          const Divider(),
          const SizedBox(height: 16),

          // API Keys
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('API Keys',
                  style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
              TextButton.icon(
                onPressed: _createApiKey,
                icon: const Icon(Icons.add, size: 18),
                label: const Text('Create'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (_loadingKeys)
            const Center(child: Padding(
              padding: EdgeInsets.all(16),
              child: CircularProgressIndicator(),
            ))
          else if (_apiKeys.isEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text('No API keys created yet',
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              ),
            )
          else
            ...(_apiKeys.map((k) => Card(
              child: ListTile(
                leading: const Icon(Icons.key, size: 20),
                title: Text(k['name'] ?? 'Unnamed', style: const TextStyle(fontSize: 14)),
                subtitle: Text(k['prefix'] ?? k['key']?.toString().substring(0, 8) ?? '',
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 12)),
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline, size: 20, color: Colors.red),
                  onPressed: () => _deleteApiKey(k['id']),
                ),
              ),
            ))),
        ],
      ),
    );
  }
}
