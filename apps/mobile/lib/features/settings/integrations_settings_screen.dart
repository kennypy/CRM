import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';

class IntegrationsSettingsScreen extends ConsumerStatefulWidget {
  const IntegrationsSettingsScreen({super.key});

  @override
  ConsumerState<IntegrationsSettingsScreen> createState() => _IntegrationsSettingsScreenState();
}

class _IntegrationsSettingsScreenState extends ConsumerState<IntegrationsSettingsScreen> {
  List<Map<String, dynamic>> _integrations = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadIntegrations();
  }

  Future<void> _loadIntegrations() async {
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.integrations);
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['integrations'] ?? []) : []);
      if (mounted) setState(() => _integrations = List<Map<String, dynamic>>.from(items));
    } catch (_) {}
    finally { if (mounted) setState(() => _loading = false); }
  }

  IconData _iconFor(String provider) {
    switch (provider.toLowerCase()) {
      case 'google': return Icons.g_mobiledata;
      case 'microsoft': return Icons.window;
      case 'slack': return Icons.chat;
      case 'zoom': return Icons.videocam;
      case 'stripe': return Icons.payment;
      default: return Icons.extension;
    }
  }

  Color _colorFor(String provider) {
    switch (provider.toLowerCase()) {
      case 'google': return Colors.red;
      case 'microsoft': return Colors.blue;
      case 'slack': return Colors.purple;
      case 'zoom': return Colors.blue;
      case 'stripe': return Colors.indigo;
      default: return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // Available integrations (show even if not connected)
    final available = ['Google', 'Microsoft', 'Slack', 'Zoom'];
    final connectedProviders = _integrations
        .map((i) => (i['provider'] ?? '').toString().toLowerCase())
        .toSet();

    return Scaffold(
      appBar: AppBar(title: const Text('Integrations')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadIntegrations,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text('Connected', style: theme.textTheme.titleSmall
                      ?.copyWith(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  if (_integrations.isEmpty)
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Text('No integrations connected yet',
                            style: theme.textTheme.bodySmall
                                ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                      ),
                    ),
                  ..._integrations.map((i) {
                    final provider = i['provider'] ?? 'Unknown';
                    final status = i['status'] ?? 'active';
                    return Card(
                      child: ListTile(
                        leading: Icon(_iconFor(provider), color: _colorFor(provider)),
                        title: Text(provider.toString()),
                        subtitle: Text(i['accountEmail'] ?? i['account_email'] ?? ''),
                        trailing: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: status == 'active'
                                ? Colors.green.withOpacity(0.1)
                                : Colors.orange.withOpacity(0.1),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(status,
                              style: TextStyle(fontSize: 11,
                                  color: status == 'active' ? Colors.green : Colors.orange)),
                        ),
                      ),
                    );
                  }),

                  const SizedBox(height: 20),
                  Text('Available', style: theme.textTheme.titleSmall
                      ?.copyWith(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  ...available
                      .where((p) => !connectedProviders.contains(p.toLowerCase()))
                      .map((p) => Card(
                        child: ListTile(
                          leading: Icon(_iconFor(p), color: _colorFor(p)),
                          title: Text(p),
                          subtitle: const Text('Not connected'),
                          trailing: OutlinedButton(
                            onPressed: () {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text('Connect $p via the web app for OAuth authorization')),
                              );
                            },
                            child: const Text('Connect'),
                          ),
                        ),
                      )),
                ],
              ),
            ),
    );
  }
}
