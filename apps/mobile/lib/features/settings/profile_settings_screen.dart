import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../core/auth/auth_provider.dart';

class ProfileSettingsScreen extends ConsumerStatefulWidget {
  const ProfileSettingsScreen({super.key});

  @override
  ConsumerState<ProfileSettingsScreen> createState() => _ProfileSettingsScreenState();
}

class _ProfileSettingsScreenState extends ConsumerState<ProfileSettingsScreen> {
  final _formKey = GlobalKey<FormState>();
  late TextEditingController _firstNameCtl;
  late TextEditingController _lastNameCtl;
  late TextEditingController _emailCtl;
  late TextEditingController _phoneCtl;
  late TextEditingController _twilioNumberCtl;
  bool _loading = false;
  bool _dirty = false;

  String _country = '';
  String _timezone = '';
  String _language = 'en';
  String _appearance = 'system';

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

  static const _countries = [
    'United States',
    'Canada',
    'United Kingdom',
    'Germany',
    'France',
    'Spain',
    'Italy',
    'Netherlands',
    'Switzerland',
    'Australia',
    'New Zealand',
    'Japan',
    'South Korea',
    'Singapore',
    'India',
    'Brazil',
    'Mexico',
    'Argentina',
    'Turkey',
    'United Arab Emirates',
    'South Africa',
  ];

  static const _languages = {
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'pt': 'Portuguese',
    'ja': 'Japanese',
    'zh': 'Chinese',
    'ko': 'Korean',
    'it': 'Italian',
    'nl': 'Dutch',
  };

  @override
  void initState() {
    super.initState();
    final user = ref.read(authProvider).user;
    _firstNameCtl = TextEditingController(text: user?.firstName ?? '');
    _lastNameCtl = TextEditingController(text: user?.lastName ?? '');
    _emailCtl = TextEditingController(text: user?.email ?? '');
    _phoneCtl = TextEditingController();
    _twilioNumberCtl = TextEditingController();
    _loadProfile();
  }

  Future<void> _loadProfile() async {
    try {
      final res = await ApiClient.instance.dio.get('${Endpoints.users}/me');
      final data = res.data['data'] ?? res.data;
      if (mounted) {
        setState(() {
          _phoneCtl.text = data['phone'] ?? '';
          _twilioNumberCtl.text = data['twilioNumber'] ?? data['twilio_number'] ?? '';
          _country = data['country'] ?? '';
          _timezone = data['timezone'] ?? '';
          _language = data['language'] ?? 'en';
          _appearance = data['appearance'] ?? data['theme'] ?? 'system';
        });
      }
    } catch (_) {}
  }

  @override
  void dispose() {
    _firstNameCtl.dispose();
    _lastNameCtl.dispose();
    _emailCtl.dispose();
    _phoneCtl.dispose();
    _twilioNumberCtl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _loading = true);
    try {
      await ApiClient.instance.dio.patch(
        '${Endpoints.users}/me',
        data: {
          'firstName': _firstNameCtl.text.trim(),
          'lastName': _lastNameCtl.text.trim(),
          'phone': _phoneCtl.text.trim(),
          'twilioNumber': _twilioNumberCtl.text.trim(),
          'country': _country,
          'timezone': _timezone,
          'language': _language,
          'appearance': _appearance,
        },
      );
      if (mounted) {
        setState(() => _dirty = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Profile updated')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to update profile')),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _markDirty() {
    if (!_dirty) setState(() => _dirty = true);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final user = ref.watch(authProvider).user;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Profile'),
        actions: [
          if (_dirty)
            TextButton(
              onPressed: _loading ? null : _save,
              child: _loading
                  ? const SizedBox(height: 16, width: 16,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Save'),
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Avatar
          Center(
            child: CircleAvatar(
              radius: 48,
              backgroundColor: theme.colorScheme.primaryContainer,
              child: Text(
                user != null ? user.firstName[0].toUpperCase() : '?',
                style: theme.textTheme.headlineLarge?.copyWith(
                    color: theme.colorScheme.onPrimaryContainer),
              ),
            ),
          ),
          const SizedBox(height: 24),

          Form(
            key: _formKey,
            onChanged: _markDirty,
            child: Column(
              children: [
                TextFormField(
                  controller: _firstNameCtl,
                  decoration: const InputDecoration(labelText: 'First name'),
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _lastNameCtl,
                  decoration: const InputDecoration(labelText: 'Last name'),
                  validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _emailCtl,
                  decoration: const InputDecoration(labelText: 'Email'),
                  enabled: false,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _phoneCtl,
                  decoration: const InputDecoration(
                    labelText: 'Phone',
                    prefixIcon: Icon(Icons.phone_outlined),
                  ),
                  keyboardType: TextInputType.phone,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _twilioNumberCtl,
                  decoration: const InputDecoration(
                    labelText: 'Twilio Number',
                    prefixIcon: Icon(Icons.sms_outlined),
                    helperText: 'Your assigned Twilio phone number',
                  ),
                  keyboardType: TextInputType.phone,
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  value: _country.isEmpty ? null : _country,
                  decoration: const InputDecoration(
                    labelText: 'Country',
                    prefixIcon: Icon(Icons.public),
                  ),
                  items: _countries.map((c) =>
                    DropdownMenuItem(value: c, child: Text(c))).toList(),
                  onChanged: (v) {
                    setState(() => _country = v ?? '');
                    _markDirty();
                  },
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  value: _timezone.isEmpty ? null : _timezone,
                  decoration: const InputDecoration(
                    labelText: 'Timezone',
                    prefixIcon: Icon(Icons.access_time),
                  ),
                  isExpanded: true,
                  items: _timezones.map((tz) =>
                    DropdownMenuItem(value: tz, child: Text(tz))).toList(),
                  onChanged: (v) {
                    setState(() => _timezone = v ?? '');
                    _markDirty();
                  },
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  value: _language,
                  decoration: const InputDecoration(
                    labelText: 'Language',
                    prefixIcon: Icon(Icons.language),
                  ),
                  items: _languages.entries.map((e) =>
                    DropdownMenuItem(value: e.key, child: Text(e.value))).toList(),
                  onChanged: (v) {
                    setState(() => _language = v ?? 'en');
                    _markDirty();
                  },
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Card(
            child: ListTile(
              leading: const Icon(Icons.badge),
              title: const Text('Role'),
              trailing: Text(
                (user?.role ?? 'rep').replaceAll('_', ' '),
                style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
              ),
            ),
          ),

          const SizedBox(height: 24),
          Text('Appearance',
              style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Theme',
                      style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant)),
                  const SizedBox(height: 12),
                  SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(
                        value: 'light',
                        label: Text('Light'),
                        icon: Icon(Icons.light_mode, size: 16),
                      ),
                      ButtonSegment(
                        value: 'dark',
                        label: Text('Dark'),
                        icon: Icon(Icons.dark_mode, size: 16),
                      ),
                      ButtonSegment(
                        value: 'system',
                        label: Text('System'),
                        icon: Icon(Icons.settings_suggest, size: 16),
                      ),
                    ],
                    selected: {_appearance},
                    onSelectionChanged: (v) {
                      setState(() => _appearance = v.first);
                      _markDirty();
                    },
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
