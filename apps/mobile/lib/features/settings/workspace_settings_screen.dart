import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';

class WorkspaceSettingsScreen extends ConsumerStatefulWidget {
  const WorkspaceSettingsScreen({super.key});

  @override
  ConsumerState<WorkspaceSettingsScreen> createState() => _WorkspaceSettingsScreenState();
}

class _WorkspaceSettingsScreenState extends ConsumerState<WorkspaceSettingsScreen> {
  Map<String, dynamic>? _tenant;
  bool _loading = true;
  bool _saving = false;
  late TextEditingController _nameCtl;
  bool _dirty = false;

  String _timezone = 'UTC';
  String _currency = 'USD';

  static const _timezones = [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Anchorage',
    'Pacific/Honolulu',
    'America/Toronto',
    'America/Vancouver',
    'America/Sao_Paulo',
    'America/Argentina/Buenos_Aires',
    'America/Mexico_City',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Madrid',
    'Europe/Rome',
    'Europe/Amsterdam',
    'Europe/Zurich',
    'Europe/Moscow',
    'Europe/Istanbul',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Asia/Seoul',
    'Asia/Hong_Kong',
    'Australia/Sydney',
    'Australia/Melbourne',
    'Pacific/Auckland',
  ];

  static const _currencies = {
    'USD': 'USD - US Dollar',
    'EUR': 'EUR - Euro',
    'GBP': 'GBP - British Pound',
    'CAD': 'CAD - Canadian Dollar',
    'AUD': 'AUD - Australian Dollar',
    'SGD': 'SGD - Singapore Dollar',
    'JPY': 'JPY - Japanese Yen',
    'CHF': 'CHF - Swiss Franc',
    'INR': 'INR - Indian Rupee',
    'BRL': 'BRL - Brazilian Real',
  };

  @override
  void initState() {
    super.initState();
    _nameCtl = TextEditingController();
    _loadTenant();
  }

  @override
  void dispose() {
    _nameCtl.dispose();
    super.dispose();
  }

  Future<void> _loadTenant() async {
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.tenant);
      if (mounted) {
        setState(() {
          _tenant = res.data['data'];
          _nameCtl.text = _tenant?['name'] ?? '';
          _timezone = _tenant?['timezone'] ?? 'UTC';
          _currency = _tenant?['defaultCurrency'] ?? _tenant?['default_currency'] ?? 'USD';
          // Ensure the loaded values exist in our lists
          if (!_timezones.contains(_timezone)) _timezone = 'UTC';
          if (!_currencies.containsKey(_currency)) _currency = 'USD';
        });
      }
    } catch (_) {}
    finally { if (mounted) setState(() => _loading = false); }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await ApiClient.instance.dio.patch(Endpoints.tenant, data: {
        'name': _nameCtl.text.trim(),
        'timezone': _timezone,
        'defaultCurrency': _currency,
      });
      if (mounted) {
        setState(() => _dirty = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Workspace updated')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to update workspace')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _markDirty() {
    if (!_dirty) setState(() => _dirty = true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Workspace'),
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
                TextFormField(
                  controller: _nameCtl,
                  decoration: const InputDecoration(
                    labelText: 'Workspace name',
                    prefixIcon: Icon(Icons.business),
                  ),
                  onChanged: (_) => _markDirty(),
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  value: _timezone,
                  decoration: const InputDecoration(
                    labelText: 'Timezone',
                    prefixIcon: Icon(Icons.access_time),
                  ),
                  isExpanded: true,
                  items: _timezones.map((tz) =>
                    DropdownMenuItem(value: tz, child: Text(tz))).toList(),
                  onChanged: (v) {
                    setState(() => _timezone = v ?? 'UTC');
                    _markDirty();
                  },
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  value: _currency,
                  decoration: const InputDecoration(
                    labelText: 'Currency',
                    prefixIcon: Icon(Icons.attach_money),
                  ),
                  isExpanded: true,
                  items: _currencies.entries.map((e) =>
                    DropdownMenuItem(value: e.key, child: Text(e.value))).toList(),
                  onChanged: (v) {
                    setState(() => _currency = v ?? 'USD');
                    _markDirty();
                  },
                ),
                const SizedBox(height: 16),
                Card(
                  child: Column(
                    children: [
                      _ReadOnlyTile(label: 'Slug', value: _tenant?['slug'] ?? '-'),
                      const Divider(height: 1),
                      _ReadOnlyTile(label: 'Plan', value: (_tenant?['plan'] ?? 'starter').toString().toUpperCase()),
                      const Divider(height: 1),
                      _ReadOnlyTile(label: 'Region', value: _tenant?['dataRegion'] ?? _tenant?['data_region'] ?? 'us'),
                    ],
                  ),
                ),
              ],
            ),
    );
  }
}

class _ReadOnlyTile extends StatelessWidget {
  final String label;
  final String value;

  const _ReadOnlyTile({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      title: Text(label, style: Theme.of(context).textTheme.bodySmall
          ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
      trailing: Text(value, style: Theme.of(context).textTheme.bodyMedium),
    );
  }
}
