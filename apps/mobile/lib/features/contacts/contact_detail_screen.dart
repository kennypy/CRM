import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/loading_indicator.dart';
import '../../shared/widgets/error_view.dart';

class ContactDetailScreen extends ConsumerStatefulWidget {
  final String contactId;
  const ContactDetailScreen({super.key, required this.contactId});

  @override
  ConsumerState<ContactDetailScreen> createState() => _ContactDetailScreenState();
}

class _ContactDetailScreenState extends ConsumerState<ContactDetailScreen> {
  Map<String, dynamic>? _contact;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadContact();
  }

  Future<void> _loadContact() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await ApiClient.instance.dio.get('${Endpoints.contacts}/${widget.contactId}');
      if (mounted) setState(() => _contact = res.data['data']);
    } catch (e) {
      if (mounted) setState(() => _error = 'Failed to load contact');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

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
      // Log the call activity
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
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text('Add Note',
                      style: Theme.of(ctx).textTheme.titleMedium
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
                    onPressed: saving ? null : () async {
                      if (noteCtl.text.trim().isEmpty) return;
                      setBtn(() => saving = true);
                      try {
                        await ApiClient.instance.dio.post(Endpoints.activities, data: {
                          'contactId': widget.contactId,
                          'type': 'note',
                          'notes': noteCtl.text.trim(),
                        });
                        if (ctx.mounted) {
                          Navigator.pop(ctx);
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Note saved')),
                          );
                        }
                      } catch (_) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Failed to save note')),
                          );
                        }
                      } finally {
                        if (ctx.mounted) setBtn(() => saving = false);
                      }
                    },
                    child: saving
                        ? const SizedBox(height: 18, width: 18,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
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

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(_contact != null
            ? '${_contact!['firstName'] ?? ''} ${_contact!['lastName'] ?? ''}'.trim()
            : 'Contact'),
        actions: [
          IconButton(icon: const Icon(Icons.edit_outlined), onPressed: () {}),
          PopupMenuButton(
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'activity', child: Text('Log Activity')),
              const PopupMenuItem(value: 'enroll', child: Text('Enroll in Sequence')),
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
                          Center(
                            child: Column(
                              children: [
                                CircleAvatar(
                                  radius: 36,
                                  backgroundColor: theme.colorScheme.primaryContainer,
                                  child: Text(
                                    (_contact!['firstName'] ?? '?')[0].toUpperCase(),
                                    style: theme.textTheme.headlineMedium?.copyWith(
                                        color: theme.colorScheme.onPrimaryContainer),
                                  ),
                                ),
                                const SizedBox(height: 12),
                                Text(
                                  '${_contact!['firstName'] ?? ''} ${_contact!['lastName'] ?? ''}'.trim(),
                                  style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
                                ),
                                if (_contact!['title'] != null)
                                  Text(_contact!['title'],
                                      style: theme.textTheme.bodyMedium?.copyWith(
                                          color: theme.colorScheme.onSurfaceVariant)),
                              ],
                            ),
                          ),
                          const SizedBox(height: 24),

                          // Contact info card
                          Card(
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('Contact Info',
                                      style: theme.textTheme.titleSmall
                                          ?.copyWith(fontWeight: FontWeight.w600)),
                                  const SizedBox(height: 12),
                                  _InfoRow(icon: Icons.email_outlined,
                                      label: 'Email', value: _contact!['email'] ?? '-'),
                                  _InfoRow(icon: Icons.phone_outlined,
                                      label: 'Phone', value: _contact!['phone'] ?? '-'),
                                  _InfoRow(icon: Icons.work_outlined,
                                      label: 'Seniority', value: _contact!['seniority'] ?? '-'),
                                ],
                              ),
                            ),
                          ),
                          const SizedBox(height: 12),

                          // Quick actions
                          Row(
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
                          ),
                        ],
                      ),
                    ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _InfoRow({required this.icon, required this.label, required this.value});

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
              Text(label, style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant)),
              Text(value, style: theme.textTheme.bodyMedium),
            ],
          ),
        ],
      ),
    );
  }
}
