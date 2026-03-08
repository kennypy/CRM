import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';

class PermissionsSettingsScreen extends ConsumerStatefulWidget {
  const PermissionsSettingsScreen({super.key});

  @override
  ConsumerState<PermissionsSettingsScreen> createState() => _PermissionsSettingsScreenState();
}

class _PermissionsSettingsScreenState extends ConsumerState<PermissionsSettingsScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  String _entityType = 'contact';

  // Field permissions
  List<Map<String, dynamic>> _fieldPerms = [];
  bool _loadingField = true;

  // Default rules
  List<Map<String, dynamic>> _defaultRules = [];
  bool _loadingDefaults = true;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadFieldPermissions();
    _loadDefaultRules();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadFieldPermissions() async {
    setState(() => _loadingField = true);
    try {
      final res = await ApiClient.instance.dio.get('${Endpoints.permissions}/fields',
          queryParameters: {'entityType': _entityType});
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? []) : []);
      if (mounted) setState(() => _fieldPerms = List<Map<String, dynamic>>.from(items));
    } catch (_) {}
    finally { if (mounted) setState(() => _loadingField = false); }
  }

  Future<void> _loadDefaultRules() async {
    setState(() => _loadingDefaults = true);
    try {
      final res = await ApiClient.instance.dio.get('${Endpoints.permissions}/defaults');
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? []) : []);
      if (mounted) setState(() => _defaultRules = List<Map<String, dynamic>>.from(items));
    } catch (_) {}
    finally { if (mounted) setState(() => _loadingDefaults = false); }
  }

  Future<void> _setFieldPermission(String field, String role, String access) async {
    try {
      await ApiClient.instance.dio.post('${Endpoints.permissions}/fields', data: {
        'entityType': _entityType,
        'field': field,
        'role': role,
        'access': access,
      });
      _loadFieldPermissions();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to update permission')),
        );
      }
    }
  }

  Future<void> _setDefaultRule(String entityType, String scope, String access) async {
    try {
      await ApiClient.instance.dio.post('${Endpoints.permissions}/defaults', data: {
        'entityType': entityType,
        'scope': scope,
        'access': access,
      });
      _loadDefaultRules();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to update rule')),
        );
      }
    }
  }

  Color _accessColor(String access) {
    switch (access) {
      case 'read_write': case 'read_write_delete': return Colors.green;
      case 'read_only': case 'read': return Colors.orange;
      case 'hidden': case 'none': return Colors.red;
      default: return Colors.grey;
    }
  }

  String _accessLabel(String access) {
    switch (access) {
      case 'read_write_delete': return 'Full';
      case 'read_write': return 'Read/Write';
      case 'read_only': case 'read': return 'Read Only';
      case 'hidden': case 'none': return 'Hidden';
      default: return access;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Permissions'),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Field Access'),
            Tab(text: 'Default Rules'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          // Field Permissions
          Column(
            children: [
              SizedBox(
                height: 50,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  children: ['contact', 'company', 'deal', 'activity', 'task'].map((e) =>
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(e[0].toUpperCase() + e.substring(1)),
                        selected: _entityType == e,
                        onSelected: (_) {
                          setState(() => _entityType = e);
                          _loadFieldPermissions();
                        },
                      ),
                    ),
                  ).toList(),
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: _loadingField
                    ? const Center(child: CircularProgressIndicator())
                    : _fieldPerms.isEmpty
                        ? Center(child: Text('No field permissions configured',
                            style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)))
                        : ListView.separated(
                            padding: const EdgeInsets.all(12),
                            itemCount: _fieldPerms.length,
                            separatorBuilder: (_, __) => const SizedBox(height: 4),
                            itemBuilder: (context, index) {
                              final p = _fieldPerms[index];
                              final field = p['field'] ?? '';
                              final role = p['role'] ?? '';
                              final access = p['access'] ?? 'read_write';

                              return Card(
                                child: ListTile(
                                  dense: true,
                                  title: Text(field, style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 14)),
                                  subtitle: Text(role.toString().replaceAll('_', ' ')),
                                  trailing: PopupMenuButton<String>(
                                    initialValue: access,
                                    onSelected: (v) => _setFieldPermission(field, role, v),
                                    child: Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: _accessColor(access).withOpacity(0.1),
                                        borderRadius: BorderRadius.circular(4),
                                      ),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Text(_accessLabel(access),
                                              style: TextStyle(fontSize: 12, color: _accessColor(access),
                                                  fontWeight: FontWeight.w600)),
                                          Icon(Icons.arrow_drop_down, size: 16, color: _accessColor(access)),
                                        ],
                                      ),
                                    ),
                                    itemBuilder: (_) => [
                                      const PopupMenuItem(value: 'read_write', child: Text('Read/Write')),
                                      const PopupMenuItem(value: 'read_only', child: Text('Read Only')),
                                      const PopupMenuItem(value: 'hidden', child: Text('Hidden')),
                                    ],
                                  ),
                                ),
                              );
                            },
                          ),
              ),
            ],
          ),

          // Default Rules
          _loadingDefaults
              ? const Center(child: CircularProgressIndicator())
              : _defaultRules.isEmpty
                  ? Center(child: Text('No default rules configured',
                      style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)))
                  : ListView.separated(
                      padding: const EdgeInsets.all(12),
                      itemCount: _defaultRules.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, index) {
                        final r = _defaultRules[index];
                        final entity = r['entityType'] ?? r['entity_type'] ?? '';
                        final scope = r['scope'] ?? '';
                        final access = r['access'] ?? 'read_write';

                        return Card(
                          child: ListTile(
                            title: Text('${entity[0].toUpperCase()}${entity.substring(1)} - ${scope.toString().replaceAll('_', ' ')}',
                                style: const TextStyle(fontWeight: FontWeight.w500)),
                            trailing: PopupMenuButton<String>(
                              initialValue: access,
                              onSelected: (v) => _setDefaultRule(entity, scope, v),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: _accessColor(access).withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(_accessLabel(access),
                                        style: TextStyle(fontSize: 12, color: _accessColor(access),
                                            fontWeight: FontWeight.w600)),
                                    Icon(Icons.arrow_drop_down, size: 16, color: _accessColor(access)),
                                  ],
                                ),
                              ),
                              itemBuilder: (_) => [
                                const PopupMenuItem(value: 'read_write_delete', child: Text('Full Access')),
                                const PopupMenuItem(value: 'read_write', child: Text('Read/Write')),
                                const PopupMenuItem(value: 'read', child: Text('Read Only')),
                                const PopupMenuItem(value: 'none', child: Text('No Access')),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
        ],
      ),
    );
  }
}
