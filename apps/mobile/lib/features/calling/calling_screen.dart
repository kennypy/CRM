import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const _dispositions = ['connected', 'voicemail', 'no_answer', 'busy', 'wrong_number'];

const _dispositionLabels = {
  'connected': 'Connected',
  'voicemail': 'Voicemail',
  'no_answer': 'No Answer',
  'busy': 'Busy',
  'wrong_number': 'Wrong Number',
};

const _dispositionIcons = {
  'connected': Icons.check_circle_outline,
  'voicemail': Icons.voicemail,
  'no_answer': Icons.phone_missed_outlined,
  'busy': Icons.phone_locked_outlined,
  'wrong_number': Icons.error_outline,
};

const _dispositionColors = {
  'connected': Colors.green,
  'voicemail': Colors.orange,
  'no_answer': Colors.grey,
  'busy': Colors.red,
  'wrong_number': Colors.deepOrange,
};

const _dtmfKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

/* ------------------------------------------------------------------ */
/*  Screen                                                             */
/* ------------------------------------------------------------------ */

class CallingScreen extends ConsumerStatefulWidget {
  const CallingScreen({super.key});

  @override
  ConsumerState<CallingScreen> createState() => _CallingScreenState();
}

class _CallingScreenState extends ConsumerState<CallingScreen> {
  // Queue & history data
  List<Map<String, dynamic>> _queue = [];
  List<Map<String, dynamic>> _history = [];
  bool _loading = true;
  String? _error;

  // Call state
  bool _callActive = false;
  int _callSeconds = 0;
  Timer? _callTimer;
  bool _muted = false;
  bool _onHold = false;
  bool _recording = false;
  bool _consentGiven = false;
  bool _showDtmf = false;
  bool _localPresence = false;
  int _queueIndex = 0;
  bool _queuePaused = true;

  // Disposition state
  bool _showDisposition = false;
  String? _selectedDisposition;
  final TextEditingController _notesController = TextEditingController();

  // Script state
  bool _scriptExpanded = false;

  // Analytics
  int _callsToday = 0;
  int _connected = 0;
  int _totalDuration = 0;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  @override
  void dispose() {
    _callTimer?.cancel();
    _notesController.dispose();
    super.dispose();
  }

  /* ---- Data loading ---- */

  Future<void> _loadData() async {
    setState(() { _loading = true; _error = null; });
    try {
      final results = await Future.wait([
        ApiClient.instance.dio.get(Endpoints.callingQueue),
        ApiClient.instance.dio.get(Endpoints.callingHistory),
      ].map((f) => f.then((v) => v).catchError((_) => null)));

      final queueRes = results[0];
      final historyRes = results[1];

      if (mounted) {
        setState(() {
          if (queueRes != null) {
            final data = queueRes.data;
            final items = data is List
                ? data
                : (data is Map ? (data['data'] ?? data['items'] ?? data['queue'] ?? []) : []);
            _queue = List<Map<String, dynamic>>.from(items);
          }
          if (historyRes != null) {
            final data = historyRes.data;
            final items = data is List
                ? data
                : (data is Map ? (data['data'] ?? data['items'] ?? data['history'] ?? []) : []);
            _history = List<Map<String, dynamic>>.from(items);
          }
        });
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load calling data');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /* ---- Call actions ---- */

  Map<String, dynamic>? get _currentContact =>
      _queue.isNotEmpty && _queueIndex < _queue.length ? _queue[_queueIndex] : null;

  void _startCall() {
    if (_currentContact == null) return;
    setState(() {
      _callActive = true;
      _callSeconds = 0;
      _muted = false;
      _onHold = false;
      _recording = false;
      _consentGiven = false;
      _showDisposition = false;
      _selectedDisposition = null;
      _showDtmf = false;
      _notesController.clear();
    });
    _callTimer?.cancel();
    _callTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _callSeconds++);
    });
  }

  void _endCall() {
    _callTimer?.cancel();
    setState(() {
      _callActive = false;
      _showDisposition = true;
      _showDtmf = false;
    });
  }

  void _skipContact() {
    if (_callActive) _endCall();
    setState(() {
      _queueIndex = (_queueIndex + 1).clamp(0, _queue.length - 1);
      _showDisposition = false;
    });
  }

  Future<void> _submitDisposition(String disposition) async {
    final contact = _currentContact;
    setState(() {
      _selectedDisposition = disposition;
      _callsToday++;
      if (disposition == 'connected') _connected++;
      _totalDuration += _callSeconds;

      if (contact != null) {
        _history.insert(0, {
          'id': 'h${DateTime.now().millisecondsSinceEpoch}',
          'contactId': contact['id'],
          'contactName': contact['name'] ?? contact['firstName'] ?? '',
          'company': contact['company'] ?? contact['companyName'] ?? '',
          'phone': contact['phone'] ?? '',
          'direction': 'outbound',
          'disposition': disposition,
          'duration': _callSeconds,
          'startedAt': DateTime.now().toIso8601String(),
          'consentGiven': _consentGiven,
          'notes': _notesController.text,
        });
      }

      _showDisposition = false;
      _queueIndex = (_queueIndex + 1).clamp(0, _queue.length - 1);
    });

    // Persist disposition to backend
    try {
      await ApiClient.instance.dio.post(
        Endpoints.callingDisposition,
        data: {
          'contactId': contact?['id'],
          'disposition': disposition,
          'duration': _callSeconds,
          'notes': _notesController.text,
          'consentGiven': _consentGiven,
          'recording': _recording,
        },
      );
    } catch (_) {
      // Optimistic update — disposition already saved locally
    }
  }

  void _dropVoicemail() {
    _submitDisposition('voicemail');
  }

  Future<void> _showTransferDialog() async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Transfer Call'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            labelText: 'Transfer to (phone or extension)',
            prefixIcon: Icon(Icons.phone_forwarded),
          ),
          keyboardType: TextInputType.phone,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text),
            child: const Text('Transfer'),
          ),
        ],
      ),
    );
    if (result != null && result.isNotEmpty) {
      _endCall();
    }
  }

  Future<void> _showAddContactsSheet() async {
    final result = await showModalBottomSheet<List<Map<String, dynamic>>>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => _AddContactsSheet(),
    );
    if (result != null && result.isNotEmpty && mounted) {
      setState(() => _queue.addAll(result));
    }
  }

  String _formatDuration(int seconds) {
    final m = seconds ~/ 60;
    final s = seconds % 60;
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }

  double get _avgDuration => _callsToday > 0 ? _totalDuration / _callsToday : 0;

  double get _connectRate => _callsToday > 0 ? (_connected / _callsToday) * 100 : 0;

  /* ---- Build ---- */

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final contact = _currentContact;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Power Dialer'),
        actions: [
          // Local presence toggle
          IconButton(
            icon: Icon(
              Icons.location_on,
              color: _localPresence ? theme.colorScheme.primary : null,
            ),
            tooltip: 'Local Presence',
            onPressed: () => setState(() => _localPresence = !_localPresence),
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadData,
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _showAddContactsSheet,
        child: const Icon(Icons.person_add),
      ),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadData)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : RefreshIndicator(
                  onRefresh: _loadData,
                  child: ListView(
                    padding: const EdgeInsets.all(12),
                    children: [
                      // Analytics summary bar
                      _buildAnalyticsBar(theme),
                      const SizedBox(height: 12),

                      // Local presence indicator
                      if (_localPresence)
                        Container(
                          margin: const EdgeInsets.only(bottom: 12),
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(
                            color: Colors.blue.shade50,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: Colors.blue.shade200),
                          ),
                          child: Row(
                            children: [
                              Icon(Icons.location_on, size: 16, color: Colors.blue.shade700),
                              const SizedBox(width: 8),
                              Text(
                                'Local Presence enabled — caller ID matches area code',
                                style: TextStyle(fontSize: 12, color: Colors.blue.shade700),
                              ),
                            ],
                          ),
                        ),

                      // Active call panel
                      if (_callActive) ...[
                        _buildActiveCallPanel(theme, contact),
                        const SizedBox(height: 12),
                      ],

                      // Disposition selector
                      if (_showDisposition) ...[
                        _buildDispositionPanel(theme),
                        const SizedBox(height: 12),
                      ],

                      // DTMF keypad
                      if (_showDtmf && _callActive) ...[
                        _buildDtmfKeypad(theme),
                        const SizedBox(height: 12),
                      ],

                      // Post-call notes
                      if (_showDisposition || _callActive) ...[
                        _buildNotesField(theme),
                        const SizedBox(height: 12),
                      ],

                      // Call scripts
                      _buildScriptsPanel(theme),
                      const SizedBox(height: 12),

                      // Queue list
                      _buildQueueSection(theme),
                    ],
                  ),
                ),
    );
  }

  /* ---- Analytics bar ---- */

  Widget _buildAnalyticsBar(ThemeData theme) {
    return Row(
      children: [
        Expanded(child: _StatCard(
          label: 'Calls Today',
          value: '$_callsToday',
          icon: Icons.phone_outlined,
          color: theme.colorScheme.primary,
        )),
        const SizedBox(width: 8),
        Expanded(child: _StatCard(
          label: 'Connected',
          value: '$_connected',
          icon: Icons.check_circle_outline,
          color: Colors.green,
        )),
        const SizedBox(width: 8),
        Expanded(child: _StatCard(
          label: 'Avg Duration',
          value: _formatDuration(_avgDuration.round()),
          icon: Icons.timer_outlined,
          color: Colors.orange,
        )),
      ],
    );
  }

  /* ---- Active call panel ---- */

  Widget _buildActiveCallPanel(ThemeData theme, Map<String, dynamic>? contact) {
    final name = contact?['name'] ?? contact?['firstName'] ?? 'Unknown';
    final company = contact?['company'] ?? contact?['companyName'] ?? '';
    final phone = contact?['phone'] ?? '';

    return Card(
      color: theme.colorScheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            // Contact info & timer
            Row(
              children: [
                CircleAvatar(
                  backgroundColor: theme.colorScheme.primary,
                  child: Icon(Icons.person, color: theme.colorScheme.onPrimary),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name.toString(),
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: theme.colorScheme.onPrimaryContainer,
                          )),
                      if (company.toString().isNotEmpty)
                        Text(company.toString(),
                            style: TextStyle(
                              fontSize: 12,
                              color: theme.colorScheme.onPrimaryContainer.withOpacity(0.7),
                            )),
                      Text(phone.toString(),
                          style: TextStyle(
                            fontSize: 12,
                            color: theme.colorScheme.onPrimaryContainer.withOpacity(0.7),
                          )),
                    ],
                  ),
                ),
                // Timer
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primary,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    _formatDuration(_callSeconds),
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: theme.colorScheme.onPrimary,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),

            // Recording toggle with consent
            Row(
              children: [
                Icon(
                  _recording ? Icons.fiber_manual_record : Icons.radio_button_unchecked,
                  size: 14,
                  color: _recording ? Colors.red : theme.colorScheme.onPrimaryContainer.withOpacity(0.5),
                ),
                const SizedBox(width: 6),
                Text(
                  _recording ? 'Recording' : 'Not recording',
                  style: TextStyle(
                    fontSize: 12,
                    color: theme.colorScheme.onPrimaryContainer.withOpacity(0.7),
                  ),
                ),
                const Spacer(),
                if (_recording)
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        _consentGiven ? Icons.verified : Icons.warning_amber,
                        size: 14,
                        color: _consentGiven ? Colors.green : Colors.orange,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        _consentGiven ? 'Consent given' : 'No consent',
                        style: TextStyle(
                          fontSize: 11,
                          color: _consentGiven ? Colors.green.shade700 : Colors.orange.shade700,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
              ],
            ),
            const SizedBox(height: 12),

            // Call control buttons
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _CallControlButton(
                  icon: _muted ? Icons.mic_off : Icons.mic,
                  label: _muted ? 'Unmute' : 'Mute',
                  active: _muted,
                  onPressed: () => setState(() => _muted = !_muted),
                ),
                _CallControlButton(
                  icon: _onHold ? Icons.play_arrow : Icons.pause,
                  label: _onHold ? 'Resume' : 'Hold',
                  active: _onHold,
                  onPressed: () => setState(() => _onHold = !_onHold),
                ),
                _CallControlButton(
                  icon: _recording ? Icons.stop : Icons.fiber_manual_record,
                  label: _recording ? 'Stop Rec' : 'Record',
                  active: _recording,
                  activeColor: Colors.red,
                  onPressed: () {
                    if (!_recording && !_consentGiven) {
                      // Prompt for consent before recording
                      showDialog(
                        context: context,
                        builder: (ctx) => AlertDialog(
                          title: const Text('Recording Consent'),
                          content: const Text(
                            'Has the other party given consent to record this call?',
                          ),
                          actions: [
                            TextButton(
                              onPressed: () {
                                Navigator.pop(ctx);
                                setState(() { _recording = true; _consentGiven = false; });
                              },
                              child: const Text('Record without consent'),
                            ),
                            FilledButton(
                              onPressed: () {
                                Navigator.pop(ctx);
                                setState(() { _recording = true; _consentGiven = true; });
                              },
                              child: const Text('Consent given'),
                            ),
                          ],
                        ),
                      );
                    } else {
                      setState(() => _recording = !_recording);
                    }
                  },
                ),
                _CallControlButton(
                  icon: Icons.dialpad,
                  label: 'Keypad',
                  active: _showDtmf,
                  onPressed: () => setState(() => _showDtmf = !_showDtmf),
                ),
                _CallControlButton(
                  icon: Icons.phone_forwarded,
                  label: 'Transfer',
                  onPressed: _showTransferDialog,
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Voicemail drop & end call
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _dropVoicemail,
                    icon: const Icon(Icons.voicemail, size: 16),
                    label: const Text('Drop VM'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: theme.colorScheme.onPrimaryContainer,
                      side: BorderSide(color: theme.colorScheme.onPrimaryContainer.withOpacity(0.3)),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _endCall,
                    icon: const Icon(Icons.call_end, size: 16),
                    label: const Text('End Call'),
                    style: FilledButton.styleFrom(
                      backgroundColor: Colors.red,
                      foregroundColor: Colors.white,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /* ---- DTMF keypad ---- */

  Widget _buildDtmfKeypad(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Keypad', style: theme.textTheme.titleSmall),
            const SizedBox(height: 8),
            GridView.count(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisCount: 3,
              mainAxisSpacing: 8,
              crossAxisSpacing: 8,
              childAspectRatio: 2,
              children: _dtmfKeys.map((key) => OutlinedButton(
                onPressed: () {
                  // Send DTMF tone
                },
                child: Text(key, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
              )).toList(),
            ),
          ],
        ),
      ),
    );
  }

  /* ---- Disposition panel ---- */

  Widget _buildDispositionPanel(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Call Disposition', style: theme.textTheme.titleSmall),
            const SizedBox(height: 4),
            Text(
              'How did the call end?',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _dispositions.map((d) {
                final selected = _selectedDisposition == d;
                final color = _dispositionColors[d] ?? Colors.grey;
                return ChoiceChip(
                  label: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        _dispositionIcons[d],
                        size: 16,
                        color: selected ? theme.colorScheme.onSecondaryContainer : color,
                      ),
                      const SizedBox(width: 6),
                      Text(_dispositionLabels[d] ?? d),
                    ],
                  ),
                  selected: selected,
                  onSelected: (_) => _submitDisposition(d),
                );
              }).toList(),
            ),
          ],
        ),
      ),
    );
  }

  /* ---- Post-call notes ---- */

  Widget _buildNotesField(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Notes', style: theme.textTheme.titleSmall),
            const SizedBox(height: 8),
            TextField(
              controller: _notesController,
              maxLines: 3,
              decoration: const InputDecoration(
                hintText: 'Add post-call notes...',
                border: OutlineInputBorder(),
                contentPadding: EdgeInsets.all(12),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /* ---- Call scripts ---- */

  Widget _buildScriptsPanel(ThemeData theme) {
    return Card(
      child: Column(
        children: [
          ListTile(
            leading: Icon(Icons.description_outlined, color: theme.colorScheme.primary),
            title: const Text('Call Scripts', style: TextStyle(fontWeight: FontWeight.w500)),
            trailing: Icon(_scriptExpanded ? Icons.expand_less : Icons.expand_more),
            onTap: () => setState(() => _scriptExpanded = !_scriptExpanded),
          ),
          if (_scriptExpanded) ...[
            const Divider(height: 1),
            _ScriptSection(
              title: 'Opening',
              body: 'Hi [Name], this is [Your Name] from [Company]. I noticed that '
                  '[Company] has been growing rapidly. I\'m reaching out because we help '
                  'teams like yours streamline their sales operations. Do you have a quick moment?',
            ),
            _ScriptSection(
              title: 'Qualification',
              body: 'To make sure I\'m not wasting your time, can I ask:\n'
                  '- What tools are you currently using?\n'
                  '- What\'s your biggest challenge with your current setup?\n'
                  '- How many people on your team would use a solution like this?',
            ),
            _ScriptSection(
              title: 'Value Proposition',
              body: 'Based on what you\'ve shared, here\'s how we can help:\n'
                  '- Reduce manual data entry by 80%\n'
                  '- Increase rep productivity by 35%\n'
                  '- Full pipeline visibility for managers',
            ),
            _ScriptSection(
              title: 'Closing',
              body: 'Would it make sense to schedule a 30-minute demo so I can show you '
                  'exactly how this would work for your team? I have availability '
                  '[suggest times].',
            ),
          ],
        ],
      ),
    );
  }

  /* ---- Queue section ---- */

  Widget _buildQueueSection(ThemeData theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Queue header with controls
        Row(
          children: [
            Icon(Icons.queue, size: 20, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Text('Dialer Queue',
                style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: theme.colorScheme.primaryContainer,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                '${_queue.length}',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: theme.colorScheme.onPrimaryContainer,
                ),
              ),
            ),
            const Spacer(),
            // Pause/play queue
            IconButton(
              icon: Icon(_queuePaused ? Icons.play_arrow : Icons.pause),
              tooltip: _queuePaused ? 'Start dialing' : 'Pause dialing',
              onPressed: () {
                setState(() => _queuePaused = !_queuePaused);
                if (!_queuePaused && !_callActive) _startCall();
              },
            ),
            IconButton(
              icon: const Icon(Icons.skip_next),
              tooltip: 'Skip',
              onPressed: _skipContact,
            ),
          ],
        ),
        const SizedBox(height: 8),

        if (_queue.isEmpty)
          const EmptyState(icon: Icons.phone_outlined, title: 'No contacts in queue')
        else
          ...List.generate(_queue.length, (index) {
            final c = _queue[index];
            final isCurrent = index == _queueIndex;
            final name = c['name'] ?? c['firstName'] ?? 'Unknown';
            final company = c['company'] ?? c['companyName'] ?? '';
            final phone = c['phone'] ?? '';
            final tags = c['tags'] is List ? List<String>.from(c['tags']) : <String>[];

            return Card(
              color: isCurrent ? theme.colorScheme.primaryContainer : null,
              shape: isCurrent
                  ? RoundedRectangleBorder(
                      side: BorderSide(color: theme.colorScheme.primary, width: 1.5),
                      borderRadius: BorderRadius.circular(12),
                    )
                  : null,
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: isCurrent
                      ? theme.colorScheme.primary
                      : theme.colorScheme.surfaceContainerHighest,
                  child: Icon(
                    Icons.person,
                    color: isCurrent
                        ? theme.colorScheme.onPrimary
                        : theme.colorScheme.onSurfaceVariant,
                    size: 20,
                  ),
                ),
                title: Text(
                  name.toString(),
                  style: TextStyle(
                    fontWeight: isCurrent ? FontWeight.w600 : FontWeight.w500,
                    fontSize: 14,
                  ),
                ),
                subtitle: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (company.toString().isNotEmpty)
                      Text(company.toString(), style: const TextStyle(fontSize: 12)),
                    Text(phone.toString(),
                        style: TextStyle(fontSize: 12, color: theme.colorScheme.onSurfaceVariant)),
                    if (tags.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Wrap(
                          spacing: 4,
                          children: tags.take(3).map((tag) => Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                            decoration: BoxDecoration(
                              color: theme.colorScheme.secondaryContainer,
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(tag,
                                style: TextStyle(
                                  fontSize: 10,
                                  color: theme.colorScheme.onSecondaryContainer,
                                )),
                          )).toList(),
                        ),
                      ),
                  ],
                ),
                trailing: isCurrent && !_callActive
                    ? FilledButton.tonalIcon(
                        onPressed: _startCall,
                        icon: const Icon(Icons.phone, size: 16),
                        label: const Text('Call', style: TextStyle(fontSize: 12)),
                        style: FilledButton.styleFrom(visualDensity: VisualDensity.compact),
                      )
                    : isCurrent && _callActive
                        ? Icon(Icons.phone_in_talk, color: Colors.green.shade600)
                        : null,
                isThreeLine: tags.isNotEmpty,
                onTap: () => setState(() => _queueIndex = index),
              ),
            );
          }),
      ],
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Supporting widgets                                                  */
/* ------------------------------------------------------------------ */

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color color;

  const _StatCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 14, color: color),
              const SizedBox(width: 4),
              Expanded(
                child: Text(label,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    overflow: TextOverflow.ellipsis),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(value,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
                color: color,
                fontFeatures: const [FontFeature.tabularFigures()],
              )),
        ],
      ),
    );
  }
}

class _CallControlButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool active;
  final Color? activeColor;
  final VoidCallback onPressed;

  const _CallControlButton({
    required this.icon,
    required this.label,
    this.active = false,
    this.activeColor,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final effectiveColor = active
        ? (activeColor ?? theme.colorScheme.primary)
        : theme.colorScheme.onPrimaryContainer;

    return InkWell(
      onTap: onPressed,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: active
                    ? effectiveColor.withOpacity(0.15)
                    : theme.colorScheme.onPrimaryContainer.withOpacity(0.08),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, size: 20, color: effectiveColor),
            ),
            const SizedBox(height: 4),
            Text(
              label,
              style: TextStyle(
                fontSize: 10,
                color: effectiveColor,
                fontWeight: active ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ScriptSection extends StatelessWidget {
  final String title;
  final String body;

  const _ScriptSection({required this.title, required this.body});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 13,
                color: theme.colorScheme.primary,
              )),
          const SizedBox(height: 4),
          Text(body,
              style: TextStyle(
                fontSize: 13,
                color: theme.colorScheme.onSurfaceVariant,
                height: 1.4,
              )),
          const SizedBox(height: 8),
          const Divider(height: 1),
        ],
      ),
    );
  }
}

class _AddContactsSheet extends ConsumerStatefulWidget {
  @override
  ConsumerState<_AddContactsSheet> createState() => _AddContactsSheetState();
}

class _AddContactsSheetState extends ConsumerState<_AddContactsSheet> {
  List<Map<String, dynamic>> _contacts = [];
  final Set<String> _selected = {};
  bool _loading = true;
  String _search = '';

  @override
  void initState() {
    super.initState();
    _loadContacts();
  }

  Future<void> _loadContacts() async {
    try {
      final res = await ApiClient.instance.dio.get(
        Endpoints.contacts,
        queryParameters: {'limit': '50'},
      );
      final data = res.data['data'];
      final items = data is List
          ? data
          : (data is Map ? (data['items'] ?? data['contacts'] ?? []) : []);
      if (mounted) setState(() => _contacts = List<Map<String, dynamic>>.from(items));
    } catch (_) {
      // Keep empty list
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> get _filteredContacts {
    if (_search.isEmpty) return _contacts;
    final q = _search.toLowerCase();
    return _contacts.where((c) {
      final name = (c['name'] ?? c['firstName'] ?? '').toString().toLowerCase();
      final company = (c['company'] ?? c['companyName'] ?? '').toString().toLowerCase();
      return name.contains(q) || company.contains(q);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DraggableScrollableSheet(
      initialChildSize: 0.75,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      expand: false,
      builder: (ctx, scrollController) => Column(
        children: [
          // Handle
          Container(
            margin: const EdgeInsets.only(top: 8),
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: theme.colorScheme.outlineVariant,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: Text('Add Contacts to Queue',
                      style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
                ),
                FilledButton(
                  onPressed: _selected.isEmpty
                      ? null
                      : () {
                          final selectedContacts = _contacts
                              .where((c) => _selected.contains(c['id']?.toString()))
                              .toList();
                          Navigator.pop(context, selectedContacts);
                        },
                  child: Text('Add (${_selected.length})'),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: TextField(
              decoration: const InputDecoration(
                hintText: 'Search contacts...',
                prefixIcon: Icon(Icons.search),
                border: OutlineInputBorder(),
                contentPadding: EdgeInsets.symmetric(horizontal: 12),
              ),
              onChanged: (v) => setState(() => _search = v),
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : ListView.builder(
                    controller: scrollController,
                    itemCount: _filteredContacts.length,
                    itemBuilder: (ctx, i) {
                      final c = _filteredContacts[i];
                      final id = c['id']?.toString() ?? '';
                      final name = c['name'] ?? c['firstName'] ?? 'Unknown';
                      final company = c['company'] ?? c['companyName'] ?? '';
                      final phone = c['phone'] ?? '';
                      return CheckboxListTile(
                        value: _selected.contains(id),
                        onChanged: (v) {
                          setState(() {
                            if (v == true) {
                              _selected.add(id);
                            } else {
                              _selected.remove(id);
                            }
                          });
                        },
                        title: Text(name.toString(), style: const TextStyle(fontSize: 14)),
                        subtitle: Text(
                          [company, phone].where((s) => s.toString().isNotEmpty).join(' - '),
                          style: const TextStyle(fontSize: 12),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
