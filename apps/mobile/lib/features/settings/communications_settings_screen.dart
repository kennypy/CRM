import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';

class CommunicationsSettingsScreen extends ConsumerStatefulWidget {
  const CommunicationsSettingsScreen({super.key});

  @override
  ConsumerState<CommunicationsSettingsScreen> createState() => _CommunicationsSettingsScreenState();
}

class _CommunicationsSettingsScreenState extends ConsumerState<CommunicationsSettingsScreen> {
  Map<String, dynamic>? _tenant;
  bool _loading = true;
  bool _saving = false;
  bool _dirty = false;

  // Email
  String _emailProvider = 'smtp';
  final _smtpHostCtl = TextEditingController();
  final _smtpPortCtl = TextEditingController(text: '587');
  final _smtpUserCtl = TextEditingController();
  final _smtpPassCtl = TextEditingController();
  final _fromNameCtl = TextEditingController();
  final _fromEmailCtl = TextEditingController();
  bool _smtpTls = true;

  // Dialler
  String _diallerProvider = 'native';
  final _twilioSidCtl = TextEditingController();
  final _twilioTokenCtl = TextEditingController();
  final _twilioFromCtl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  @override
  void dispose() {
    _smtpHostCtl.dispose();
    _smtpPortCtl.dispose();
    _smtpUserCtl.dispose();
    _smtpPassCtl.dispose();
    _fromNameCtl.dispose();
    _fromEmailCtl.dispose();
    _twilioSidCtl.dispose();
    _twilioTokenCtl.dispose();
    _twilioFromCtl.dispose();
    super.dispose();
  }

  Future<void> _loadSettings() async {
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.tenant);
      if (mounted) {
        _tenant = res.data['data'];
        final s = _tenant?['settings'] ?? {};
        final comms = s['communications'] ?? {};
        final email = comms['email'] ?? {};
        final dialler = comms['dialler'] ?? {};

        _emailProvider = email['provider'] ?? 'smtp';
        _smtpHostCtl.text = email['smtpHost'] ?? '';
        _smtpPortCtl.text = (email['smtpPort'] ?? 587).toString();
        _smtpUserCtl.text = email['smtpUsername'] ?? '';
        _smtpPassCtl.text = email['smtpPassword'] ?? '';
        _fromNameCtl.text = email['fromName'] ?? '';
        _fromEmailCtl.text = email['fromEmail'] ?? '';
        _smtpTls = email['smtpTls'] ?? true;

        _diallerProvider = dialler['provider'] ?? 'native';
        _twilioSidCtl.text = dialler['twilioSid'] ?? '';
        _twilioTokenCtl.text = dialler['twilioToken'] ?? '';
        _twilioFromCtl.text = dialler['twilioFrom'] ?? '';

        setState(() {});
      }
    } catch (_) {}
    finally { if (mounted) setState(() => _loading = false); }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await ApiClient.instance.dio.patch(Endpoints.tenant, data: {
        'settings': {
          'communications': {
            'email': {
              'provider': _emailProvider,
              'smtpHost': _smtpHostCtl.text,
              'smtpPort': int.tryParse(_smtpPortCtl.text) ?? 587,
              'smtpUsername': _smtpUserCtl.text,
              'smtpPassword': _smtpPassCtl.text,
              'fromName': _fromNameCtl.text,
              'fromEmail': _fromEmailCtl.text,
              'smtpTls': _smtpTls,
            },
            'dialler': {
              'provider': _diallerProvider,
              'twilioSid': _twilioSidCtl.text,
              'twilioToken': _twilioTokenCtl.text,
              'twilioFrom': _twilioFromCtl.text,
            },
          },
        },
      });
      if (mounted) {
        setState(() => _dirty = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Communications settings saved')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to save settings')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _markDirty() { if (!_dirty) setState(() => _dirty = true); }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Communications'),
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
                // Email Configuration
                Text('Email Configuration',
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                const SizedBox(height: 12),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        DropdownButtonFormField<String>(
                          value: _emailProvider,
                          decoration: const InputDecoration(labelText: 'Provider'),
                          items: const [
                            DropdownMenuItem(value: 'smtp', child: Text('SMTP')),
                            DropdownMenuItem(value: 'gmail', child: Text('Gmail')),
                            DropdownMenuItem(value: 'outlook', child: Text('Outlook')),
                            DropdownMenuItem(value: 'sendgrid', child: Text('SendGrid')),
                          ],
                          onChanged: (v) { setState(() => _emailProvider = v!); _markDirty(); },
                        ),
                        if (_emailProvider == 'smtp') ...[
                          const SizedBox(height: 12),
                          Row(
                            children: [
                              Expanded(
                                flex: 3,
                                child: TextField(
                                  controller: _smtpHostCtl,
                                  decoration: const InputDecoration(labelText: 'SMTP Host'),
                                  onChanged: (_) => _markDirty(),
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: TextField(
                                  controller: _smtpPortCtl,
                                  decoration: const InputDecoration(labelText: 'Port'),
                                  keyboardType: TextInputType.number,
                                  onChanged: (_) => _markDirty(),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _smtpUserCtl,
                            decoration: const InputDecoration(labelText: 'Username'),
                            onChanged: (_) => _markDirty(),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _smtpPassCtl,
                            decoration: const InputDecoration(labelText: 'Password'),
                            obscureText: true,
                            onChanged: (_) => _markDirty(),
                          ),
                          SwitchListTile(
                            title: const Text('TLS'),
                            value: _smtpTls,
                            onChanged: (v) { setState(() => _smtpTls = v); _markDirty(); },
                            contentPadding: EdgeInsets.zero,
                          ),
                        ],
                        if (_emailProvider == 'gmail' || _emailProvider == 'outlook')
                          Padding(
                            padding: const EdgeInsets.only(top: 12),
                            child: Text('Connect via Integrations settings',
                                style: theme.textTheme.bodySmall?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant)),
                          ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _fromNameCtl,
                          decoration: const InputDecoration(labelText: 'From name'),
                          onChanged: (_) => _markDirty(),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _fromEmailCtl,
                          decoration: const InputDecoration(labelText: 'From email'),
                          keyboardType: TextInputType.emailAddress,
                          onChanged: (_) => _markDirty(),
                        ),
                      ],
                    ),
                  ),
                ),

                const SizedBox(height: 24),

                // Dialler Configuration
                Text('Dialler Configuration',
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                const SizedBox(height: 12),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        DropdownButtonFormField<String>(
                          value: _diallerProvider,
                          decoration: const InputDecoration(labelText: 'Provider'),
                          items: const [
                            DropdownMenuItem(value: 'native', child: Text('Native (tel: links)')),
                            DropdownMenuItem(value: 'twilio', child: Text('Twilio')),
                            DropdownMenuItem(value: 'voip', child: Text('Custom VOIP/SIP')),
                          ],
                          onChanged: (v) { setState(() => _diallerProvider = v!); _markDirty(); },
                        ),
                        if (_diallerProvider == 'twilio') ...[
                          const SizedBox(height: 12),
                          TextField(
                            controller: _twilioSidCtl,
                            decoration: const InputDecoration(labelText: 'Account SID'),
                            onChanged: (_) => _markDirty(),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _twilioTokenCtl,
                            decoration: const InputDecoration(labelText: 'Auth Token'),
                            obscureText: true,
                            onChanged: (_) => _markDirty(),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _twilioFromCtl,
                            decoration: const InputDecoration(labelText: 'From number'),
                            keyboardType: TextInputType.phone,
                            onChanged: (_) => _markDirty(),
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
}
