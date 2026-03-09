import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/loading_indicator.dart';
import '../../shared/widgets/error_view.dart';

// ---------------------------------------------------------------------------
// Lifecycle stage helpers
// ---------------------------------------------------------------------------
enum LifecycleStage {
  subscriber('Subscriber', Colors.grey),
  lead('Lead', Colors.blue),
  mql('MQL', Colors.indigo),
  sql('SQL', Colors.deepPurple),
  opportunity('Opportunity', Colors.orange),
  customer('Customer', Colors.green);

  const LifecycleStage(this.label, this.color);
  final String label;
  final Color color;

  static LifecycleStage fromString(String? value) {
    if (value == null) return LifecycleStage.subscriber;
    final lower = value.toLowerCase();
    return LifecycleStage.values.firstWhere(
      (s) => s.name == lower,
      orElse: () => LifecycleStage.subscriber,
    );
  }
}

// ---------------------------------------------------------------------------
// Activity icon helper
// ---------------------------------------------------------------------------
IconData _activityIcon(String? type) {
  switch (type?.toLowerCase()) {
    case 'call':
      return Icons.phone;
    case 'email':
      return Icons.email;
    case 'meeting':
      return Icons.event;
    case 'note':
      return Icons.note;
    case 'task':
      return Icons.check_circle_outline;
    default:
      return Icons.circle_outlined;
  }
}

Color _activityColor(String? type) {
  switch (type?.toLowerCase()) {
    case 'call':
      return Colors.green;
    case 'email':
      return Colors.blue;
    case 'meeting':
      return Colors.purple;
    case 'note':
      return Colors.amber.shade700;
    case 'task':
      return Colors.teal;
    default:
      return Colors.grey;
  }
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
class ContactDetailScreen extends ConsumerStatefulWidget {
  final String contactId;
  const ContactDetailScreen({super.key, required this.contactId});

  @override
  ConsumerState<ContactDetailScreen> createState() =>
      _ContactDetailScreenState();
}

class _ContactDetailScreenState extends ConsumerState<ContactDetailScreen> {
  Map<String, dynamic>? _contact;
  List<String> _tags = [];
  List<Map<String, dynamic>> _notes = [];
  List<Map<String, dynamic>> _activities = [];
  List<Map<String, dynamic>> _deals = [];
  List<Map<String, dynamic>> _users = [];
  bool _loading = true;
  String? _error;

  // GDPR local state
  bool _gdprConsent = false;
  bool _doNotContact = false;
  bool _prefEmail = true;
  bool _prefPhone = true;
  bool _prefSms = true;
  bool _gdprSaving = false;

  @override
  void initState() {
    super.initState();
    _loadContact();
  }

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------
  Future<void> _loadContact() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await ApiClient.instance.dio
          .get('${Endpoints.contacts}/${widget.contactId}');
      if (mounted) {
        setState(() => _contact = res.data['data']);
        _syncGdprFromContact();
      }

      // Load tags, notes, activities, deals, users in parallel
      await Future.wait([
        _loadTags(),
        _loadNotes(),
        _loadActivities(),
        _loadDeals(),
        _loadUsers(),
      ]);
    } catch (e) {
      if (mounted) setState(() => _error = 'Failed to load contact');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadTags() async {
    try {
      final tagRes = await ApiClient.instance.dio
          .get('${Endpoints.tags}/contact/${widget.contactId}');
      if (mounted) {
        final tagData = tagRes.data['data'] ?? [];
        setState(() => _tags = List<String>.from(
            tagData.map((t) => t is String ? t : t['tag'] ?? '')));
      }
    } catch (_) {}
  }

  Future<void> _loadNotes() async {
    try {
      final noteRes = await ApiClient.instance.dio
          .get('${Endpoints.notes}/contact/${widget.contactId}');
      if (mounted) {
        setState(() => _notes =
            List<Map<String, dynamic>>.from(noteRes.data['data'] ?? []));
      }
    } catch (_) {}
  }

  Future<void> _loadActivities() async {
    try {
      final res = await ApiClient.instance.dio.get(
        Endpoints.activities,
        queryParameters: {'contactId': widget.contactId},
      );
      if (mounted) {
        final data = res.data['data'];
        final items = data is List
            ? data
            : (data is Map
                ? (data['items'] ?? data['activities'] ?? [])
                : []);
        setState(() =>
            _activities = List<Map<String, dynamic>>.from(items));
      }
    } catch (_) {}
  }

  Future<void> _loadDeals() async {
    try {
      final res = await ApiClient.instance.dio.get(
        Endpoints.deals,
        queryParameters: {'contactId': widget.contactId},
      );
      if (mounted) {
        final data = res.data['data'];
        final items = data is List
            ? data
            : (data is Map ? (data['items'] ?? data['deals'] ?? []) : []);
        setState(
            () => _deals = List<Map<String, dynamic>>.from(items));
      }
    } catch (_) {}
  }

  Future<void> _loadUsers() async {
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.users);
      if (mounted) {
        final data = res.data['data'];
        final items = data is List
            ? data
            : (data is Map ? (data['items'] ?? data['users'] ?? []) : []);
        setState(
            () => _users = List<Map<String, dynamic>>.from(items));
      }
    } catch (_) {}
  }

  void _syncGdprFromContact() {
    if (_contact == null) return;
    final gdpr = _contact!['gdpr'] ?? _contact!['gdprConsent'];
    if (gdpr is Map) {
      _gdprConsent = gdpr['consent'] == true;
      _doNotContact = gdpr['doNotContact'] == true;
      final prefs = gdpr['communicationPreferences'];
      if (prefs is Map) {
        _prefEmail = prefs['email'] != false;
        _prefPhone = prefs['phone'] != false;
        _prefSms = prefs['sms'] != false;
      }
    } else {
      _gdprConsent = _contact!['gdprConsent'] == true;
      _doNotContact = _contact!['doNotContact'] == true;
      _prefEmail = _contact!['prefEmail'] != false;
      _prefPhone = _contact!['prefPhone'] != false;
      _prefSms = _contact!['prefSms'] != false;
    }
  }

  // -------------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------------
  Future<void> _addTag() async {
    final ctl = TextEditingController();
    final tag = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Add Tag'),
        content: TextField(
          controller: ctl,
          decoration: const InputDecoration(hintText: 'Tag name'),
          autofocus: true,
          onSubmitted: (v) => Navigator.pop(ctx, v.trim()),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.pop(ctx, ctl.text.trim()),
              child: const Text('Add')),
        ],
      ),
    );
    if (tag == null || tag.isEmpty) return;
    try {
      await ApiClient.instance.dio.post(
          '${Endpoints.tags}/contact/${widget.contactId}',
          data: {
            'tags': [tag]
          });
      setState(() => _tags.add(tag));
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Failed to add tag')));
      }
    }
  }

  Future<void> _removeTag(String tag) async {
    try {
      await ApiClient.instance.dio
          .delete('${Endpoints.tags}/contact/${widget.contactId}/$tag');
      setState(() => _tags.remove(tag));
    } catch (_) {}
  }

  // -------------------------------------------------------------------------
  // Lifecycle stage
  // -------------------------------------------------------------------------
  Future<void> _changeLifecycleStage(LifecycleStage stage) async {
    try {
      await ApiClient.instance.dio.patch(
        '${Endpoints.contacts}/${widget.contactId}',
        data: {'lifecycleStage': stage.name},
      );
      setState(() => _contact!['lifecycleStage'] = stage.name);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Stage updated to ${stage.label}')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to update stage')),
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Owner assignment
  // -------------------------------------------------------------------------
  Future<void> _changeOwner() async {
    final selected = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Assign Owner'),
        children: _users.isEmpty
            ? [
                const Padding(
                  padding: EdgeInsets.all(24),
                  child: Text('No users available'),
                )
              ]
            : _users.map((u) {
                final name =
                    '${u['firstName'] ?? ''} ${u['lastName'] ?? ''}'.trim();
                final email = u['email'] ?? '';
                return SimpleDialogOption(
                  onPressed: () => Navigator.pop(ctx, u),
                  child: ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: CircleAvatar(
                      radius: 16,
                      child: Text(name.isNotEmpty ? name[0] : '?',
                          style: const TextStyle(fontSize: 14)),
                    ),
                    title: Text(name.isNotEmpty ? name : email),
                    subtitle: name.isNotEmpty ? Text(email, style: const TextStyle(fontSize: 12)) : null,
                  ),
                );
              }).toList(),
      ),
    );
    if (selected == null) return;
    try {
      await ApiClient.instance.dio.patch(
        '${Endpoints.contacts}/${widget.contactId}',
        data: {'ownerId': selected['id']},
      );
      setState(() {
        _contact!['ownerId'] = selected['id'];
        _contact!['ownerName'] =
            '${selected['firstName'] ?? ''} ${selected['lastName'] ?? ''}'
                .trim();
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Owner updated')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to update owner')),
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // GDPR save
  // -------------------------------------------------------------------------
  Future<void> _saveGdpr() async {
    setState(() => _gdprSaving = true);
    try {
      await ApiClient.instance.dio.patch(
        '${Endpoints.contacts}/${widget.contactId}',
        data: {
          'gdprConsent': _gdprConsent,
          'doNotContact': _doNotContact,
          'communicationPreferences': {
            'email': _prefEmail,
            'phone': _prefPhone,
            'sms': _prefSms,
          },
        },
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('GDPR preferences saved')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to save GDPR preferences')),
        );
      }
    } finally {
      if (mounted) setState(() => _gdprSaving = false);
    }
  }

  // -------------------------------------------------------------------------
  // Utility helpers
  // -------------------------------------------------------------------------
  String _formatDate(dynamic dateStr) {
    if (dateStr == null) return '';
    try {
      final d = DateTime.parse(dateStr.toString());
      return '${d.day}/${d.month}/${d.year}';
    } catch (_) {
      return '';
    }
  }

  String _formatDateTime(dynamic dateStr) {
    if (dateStr == null) return '';
    try {
      final d = DateTime.parse(dateStr.toString());
      final hour = d.hour.toString().padLeft(2, '0');
      final min = d.minute.toString().padLeft(2, '0');
      return '${d.day}/${d.month}/${d.year} $hour:$min';
    } catch (_) {
      return '';
    }
  }

  String _formatCurrency(dynamic value) {
    if (value == null) return '-';
    final num v = value is num ? value : num.tryParse(value.toString()) ?? 0;
    if (v >= 1000000) return '\$${(v / 1000000).toStringAsFixed(1)}M';
    if (v >= 1000) return '\$${(v / 1000).toStringAsFixed(1)}K';
    return '\$${v.toStringAsFixed(0)}';
  }

  String _ownerDisplayName() {
    final ownerName = _contact?['ownerName'];
    if (ownerName != null && ownerName.toString().trim().isNotEmpty) {
      return ownerName.toString();
    }
    // Try to find in users list by ownerId
    final ownerId = _contact?['ownerId'];
    if (ownerId != null && _users.isNotEmpty) {
      final user = _users.cast<Map<String, dynamic>?>().firstWhere(
            (u) => u?['id'] == ownerId,
            orElse: () => null,
          );
      if (user != null) {
        return '${user['firstName'] ?? ''} ${user['lastName'] ?? ''}'.trim();
      }
    }
    return 'Unassigned';
  }

  // -------------------------------------------------------------------------
  // Action handlers (existing)
  // -------------------------------------------------------------------------
  Future<void> _handleCall() async {
    final phone = _contact?['phone'];
    if (phone == null || phone.toString().isEmpty || phone == '-') {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No phone number available')),
      );
      return;
    }
    final uri = Uri(scheme: 'tel', path: phone.toString());
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
      try {
        await ApiClient.instance.dio.post(Endpoints.activities, data: {
          'contactId': widget.contactId,
          'type': 'call',
          'notes': 'Outbound call',
        });
      } catch (_) {}
    } else {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not launch phone dialer')),
        );
      }
    }
  }

  Future<void> _handleEmail() async {
    final email = _contact?['email'];
    if (email == null || email.toString().isEmpty || email == '-') {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No email address available')),
      );
      return;
    }
    final uri = Uri(scheme: 'mailto', path: email.toString());
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    } else {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not launch email client')),
        );
      }
    }
  }

  void _handleNote() {
    final noteCtl = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(
            16, 16, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text('Add Note',
                      style: Theme.of(ctx)
                          .textTheme
                          .titleMedium
                          ?.copyWith(fontWeight: FontWeight.bold)),
                ),
                IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.pop(ctx),
                ),
              ],
            ),
            const SizedBox(height: 8),
            TextField(
              controller: noteCtl,
              decoration: const InputDecoration(
                hintText: 'Write a note...',
                border: OutlineInputBorder(),
              ),
              maxLines: 4,
              autofocus: true,
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 44,
              child: StatefulBuilder(
                builder: (ctx2, setBtn) {
                  bool saving = false;
                  return ElevatedButton(
                    onPressed: saving
                        ? null
                        : () async {
                            if (noteCtl.text.trim().isEmpty) return;
                            setBtn(() => saving = true);
                            try {
                              await ApiClient.instance.dio
                                  .post(Endpoints.activities, data: {
                                'contactId': widget.contactId,
                                'type': 'note',
                                'notes': noteCtl.text.trim(),
                              });
                              if (ctx.mounted) {
                                Navigator.pop(ctx);
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(content: Text('Note saved')),
                                );
                                _loadActivities();
                              }
                            } catch (_) {
                              if (ctx.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                      content: Text('Failed to save note')),
                                );
                              }
                            } finally {
                              if (ctx.mounted) setBtn(() => saving = false);
                            }
                          },
                    child: saving
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white))
                        : const Text('Save Note'),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Build
  // -------------------------------------------------------------------------
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(_contact != null
            ? '${_contact!['firstName'] ?? ''} ${_contact!['lastName'] ?? ''}'
                .trim()
            : 'Contact'),
        actions: [
          IconButton(
              icon: const Icon(Icons.edit_outlined), onPressed: () {}),
          PopupMenuButton(
            itemBuilder: (_) => [
              const PopupMenuItem(
                  value: 'activity', child: Text('Log Activity')),
              const PopupMenuItem(
                  value: 'enroll', child: Text('Enroll in Sequence')),
              const PopupMenuItem(value: 'delete', child: Text('Delete')),
            ],
          ),
        ],
      ),
      body: _loading
          ? const LoadingIndicator()
          : _error != null
              ? ErrorView(message: _error!, onRetry: _loadContact)
              : _contact == null
                  ? const ErrorView(message: 'Contact not found')
                  : RefreshIndicator(
                      onRefresh: _loadContact,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          // Avatar + name header
                          _buildHeader(theme),
                          const SizedBox(height: 8),

                          // Lifecycle stage badge + dropdown
                          _buildLifecycleStageBadge(theme),
                          const SizedBox(height: 16),

                          // Owner assignment
                          _buildOwnerRow(theme),
                          const SizedBox(height: 16),

                          // Contact info card
                          _buildContactInfoCard(theme),
                          const SizedBox(height: 12),

                          // Quick actions
                          _buildQuickActions(),
                          const SizedBox(height: 16),

                          // Tags section
                          _buildTagsCard(theme),
                          const SizedBox(height: 12),

                          // GDPR Consent section
                          _buildGdprCard(theme),
                          const SizedBox(height: 12),

                          // Related Deals section
                          _buildDealsCard(theme),
                          const SizedBox(height: 12),

                          // Activity History section
                          _buildActivityHistoryCard(theme),
                          const SizedBox(height: 12),

                          // Notes section
                          _buildNotesCard(theme),
                        ],
                      ),
                    ),
    );
  }

  // -------------------------------------------------------------------------
  // Widget builders
  // -------------------------------------------------------------------------

  Widget _buildHeader(ThemeData theme) {
    return Center(
      child: Column(
        children: [
          CircleAvatar(
            radius: 36,
            backgroundColor: theme.colorScheme.primaryContainer,
            child: Text(
              (_contact!['firstName'] ?? '?')[0].toUpperCase(),
              style: theme.textTheme.headlineMedium
                  ?.copyWith(color: theme.colorScheme.onPrimaryContainer),
            ),
          ),
          const SizedBox(height: 12),
          Text(
            '${_contact!['firstName'] ?? ''} ${_contact!['lastName'] ?? ''}'
                .trim(),
            style: theme.textTheme.titleLarge
                ?.copyWith(fontWeight: FontWeight.bold),
          ),
          if (_contact!['title'] != null)
            Text(_contact!['title'],
                style: theme.textTheme.bodyMedium
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
        ],
      ),
    );
  }

  Widget _buildLifecycleStageBadge(ThemeData theme) {
    final currentStage = LifecycleStage.fromString(
        _contact!['lifecycleStage']?.toString());
    return Center(
      child: PopupMenuButton<LifecycleStage>(
        onSelected: _changeLifecycleStage,
        tooltip: 'Change lifecycle stage',
        itemBuilder: (_) => LifecycleStage.values
            .map((s) => PopupMenuItem(
                  value: s,
                  child: Row(
                    children: [
                      Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                          color: s.color,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(s.label),
                      if (s == currentStage) ...[
                        const Spacer(),
                        Icon(Icons.check,
                            size: 18, color: theme.colorScheme.primary),
                      ],
                    ],
                  ),
                ))
            .toList(),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: currentStage.color.withOpacity(0.12),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: currentStage.color.withOpacity(0.4)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: currentStage.color,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 6),
              Text(
                currentStage.label,
                style: TextStyle(
                  color: currentStage.color,
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                ),
              ),
              const SizedBox(width: 4),
              Icon(Icons.arrow_drop_down,
                  size: 18, color: currentStage.color),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildOwnerRow(ThemeData theme) {
    final ownerName = _ownerDisplayName();
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            Icon(Icons.person_outline,
                size: 20, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Owner',
                      style: theme.textTheme.labelSmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant)),
                  const SizedBox(height: 2),
                  Text(ownerName, style: theme.textTheme.bodyMedium),
                ],
              ),
            ),
            TextButton.icon(
              onPressed: _changeOwner,
              icon: const Icon(Icons.swap_horiz, size: 18),
              label: const Text('Reassign'),
              style: TextButton.styleFrom(
                  visualDensity: VisualDensity.compact),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildContactInfoCard(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Contact Info',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 12),
            _InfoRow(
                icon: Icons.email_outlined,
                label: 'Email',
                value: _contact!['email'] ?? '-'),
            _InfoRow(
                icon: Icons.phone_outlined,
                label: 'Phone',
                value: _contact!['phone'] ?? '-'),
            _InfoRow(
                icon: Icons.work_outlined,
                label: 'Seniority',
                value: _contact!['seniority'] ?? '-'),
          ],
        ),
      ),
    );
  }

  Widget _buildQuickActions() {
    return Row(
      children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: _handleCall,
            icon: const Icon(Icons.phone, size: 18),
            label: const Text('Call'),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: OutlinedButton.icon(
            onPressed: _handleEmail,
            icon: const Icon(Icons.email, size: 18),
            label: const Text('Email'),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: OutlinedButton.icon(
            onPressed: _handleNote,
            icon: const Icon(Icons.note_add, size: 18),
            label: const Text('Note'),
          ),
        ),
      ],
    );
  }

  Widget _buildTagsCard(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Tags',
                    style: theme.textTheme.titleSmall
                        ?.copyWith(fontWeight: FontWeight.w600)),
                IconButton(
                  icon: const Icon(Icons.add, size: 20),
                  onPressed: _addTag,
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
            const SizedBox(height: 8),
            _tags.isEmpty
                ? Text('No tags',
                    style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant))
                : Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: _tags
                        .map((tag) => Chip(
                              label: Text(tag,
                                  style: const TextStyle(fontSize: 12)),
                              deleteIcon:
                                  const Icon(Icons.close, size: 14),
                              onDeleted: () => _removeTag(tag),
                              visualDensity: VisualDensity.compact,
                              materialTapTargetSize:
                                  MaterialTapTargetSize.shrinkWrap,
                            ))
                        .toList(),
                  ),
          ],
        ),
      ),
    );
  }

  Widget _buildGdprCard(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.shield_outlined,
                    size: 20, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text('GDPR & Privacy',
                    style: theme.textTheme.titleSmall
                        ?.copyWith(fontWeight: FontWeight.w600)),
              ],
            ),
            const SizedBox(height: 12),
            SwitchListTile.adaptive(
              title: const Text('GDPR Consent'),
              subtitle: const Text('Contact has given consent for data processing'),
              value: _gdprConsent,
              onChanged: (v) => setState(() => _gdprConsent = v),
              dense: true,
              contentPadding: EdgeInsets.zero,
            ),
            SwitchListTile.adaptive(
              title: const Text('Do Not Contact'),
              subtitle: const Text('Block all outbound communication'),
              value: _doNotContact,
              onChanged: (v) => setState(() => _doNotContact = v),
              dense: true,
              contentPadding: EdgeInsets.zero,
            ),
            const Divider(),
            Padding(
              padding: const EdgeInsets.only(top: 4, bottom: 8),
              child: Text('Communication Preferences',
                  style: theme.textTheme.labelMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant)),
            ),
            SwitchListTile.adaptive(
              title: const Text('Email'),
              value: _prefEmail,
              onChanged: _doNotContact
                  ? null
                  : (v) => setState(() => _prefEmail = v),
              dense: true,
              contentPadding: EdgeInsets.zero,
            ),
            SwitchListTile.adaptive(
              title: const Text('Phone'),
              value: _prefPhone,
              onChanged: _doNotContact
                  ? null
                  : (v) => setState(() => _prefPhone = v),
              dense: true,
              contentPadding: EdgeInsets.zero,
            ),
            SwitchListTile.adaptive(
              title: const Text('SMS'),
              value: _prefSms,
              onChanged: _doNotContact
                  ? null
                  : (v) => setState(() => _prefSms = v),
              dense: true,
              contentPadding: EdgeInsets.zero,
            ),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _gdprSaving ? null : _saveGdpr,
                child: _gdprSaving
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Text('Save GDPR Preferences'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDealsCard(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.handshake_outlined,
                    size: 20, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text('Related Deals',
                    style: theme.textTheme.titleSmall
                        ?.copyWith(fontWeight: FontWeight.w600)),
                const Spacer(),
                Text('${_deals.length}',
                    style: theme.textTheme.labelMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant)),
              ],
            ),
            const SizedBox(height: 12),
            if (_deals.isEmpty)
              Text('No deals associated',
                  style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant))
            else
              ..._deals.map((deal) {
                final dealName =
                    deal['name'] ?? deal['title'] ?? 'Untitled Deal';
                final stage = deal['stage'] ?? deal['status'] ?? '-';
                final value = deal['value'] ?? deal['amount'];
                final closeDate = deal['closeDate'] ?? deal['expectedCloseDate'];
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest
                        .withOpacity(0.4),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                        color: theme.colorScheme.outlineVariant
                            .withOpacity(0.5)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(dealName.toString(),
                                style: theme.textTheme.bodyMedium?.copyWith(
                                    fontWeight: FontWeight.w600)),
                          ),
                          if (value != null)
                            Text(_formatCurrency(value),
                                style: theme.textTheme.bodyMedium?.copyWith(
                                    fontWeight: FontWeight.bold,
                                    color: theme.colorScheme.primary)),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: theme.colorScheme.secondaryContainer,
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              stage.toString(),
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w500,
                                color: theme
                                    .colorScheme.onSecondaryContainer,
                              ),
                            ),
                          ),
                          if (closeDate != null) ...[
                            const Spacer(),
                            Icon(Icons.calendar_today,
                                size: 12,
                                color: theme
                                    .colorScheme.onSurfaceVariant),
                            const SizedBox(width: 4),
                            Text(
                              'Close: ${_formatDate(closeDate)}',
                              style: theme.textTheme.bodySmall?.copyWith(
                                  color: theme
                                      .colorScheme.onSurfaceVariant,
                                  fontSize: 11),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                );
              }),
          ],
        ),
      ),
    );
  }

  Widget _buildActivityHistoryCard(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.history,
                    size: 20, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text('Activity History',
                    style: theme.textTheme.titleSmall
                        ?.copyWith(fontWeight: FontWeight.w600)),
                const Spacer(),
                Text('${_activities.length}',
                    style: theme.textTheme.labelMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant)),
              ],
            ),
            const SizedBox(height: 12),
            if (_activities.isEmpty)
              Text('No activities yet',
                  style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant))
            else
              ..._activities.take(10).toList().asMap().entries.map((entry) {
                final index = entry.key;
                final activity = entry.value;
                final type = activity['type']?.toString();
                final subject = activity['subject'] ??
                    activity['notes'] ??
                    activity['type'] ??
                    '';
                final timestamp =
                    activity['createdAt'] ?? activity['timestamp'];
                final isLast = index == (_activities.length - 1).clamp(0, 9);
                return _ActivityTimelineItem(
                  icon: _activityIcon(type),
                  iconColor: _activityColor(type),
                  type: type ?? 'activity',
                  subject: subject.toString(),
                  timestamp: _formatDateTime(timestamp),
                  showLine: !isLast,
                );
              }),
            if (_activities.length > 10)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Center(
                  child: TextButton(
                    onPressed: () {
                      // Could navigate to full activity list
                    },
                    child: Text(
                        'View all ${_activities.length} activities'),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildNotesCard(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Notes',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            if (_notes.isEmpty)
              Text('No notes yet',
                  style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant))
            else
              ..._notes.take(5).map((note) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          note['content'] ?? '',
                          style: theme.textTheme.bodyMedium,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${note['authorName'] ?? 'Unknown'} \u2022 ${_formatDate(note['createdAt'])}',
                          style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                              fontSize: 11),
                        ),
                        if (note != _notes.last)
                          const Divider(height: 16),
                      ],
                    ),
                  )),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Reusable widgets
// ---------------------------------------------------------------------------

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _InfoRow(
      {required this.icon, required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(icon, size: 18, color: theme.colorScheme.onSurfaceVariant),
          const SizedBox(width: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label,
                  style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant)),
              Text(value, style: theme.textTheme.bodyMedium),
            ],
          ),
        ],
      ),
    );
  }
}

class _ActivityTimelineItem extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String type;
  final String subject;
  final String timestamp;
  final bool showLine;

  const _ActivityTimelineItem({
    required this.icon,
    required this.iconColor,
    required this.type,
    required this.subject,
    required this.timestamp,
    required this.showLine,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 32,
            child: Column(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: iconColor.withOpacity(0.12),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(icon, size: 14, color: iconColor),
                ),
                if (showLine)
                  Expanded(
                    child: Container(
                      width: 2,
                      color: theme.colorScheme.outlineVariant,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        type[0].toUpperCase() + type.substring(1),
                        style: theme.textTheme.labelMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: iconColor,
                        ),
                      ),
                      const Spacer(),
                      Text(timestamp,
                          style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                              fontSize: 11)),
                    ],
                  ),
                  if (subject.isNotEmpty &&
                      subject.toLowerCase() != type.toLowerCase())
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        subject,
                        style: theme.textTheme.bodySmall,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
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
