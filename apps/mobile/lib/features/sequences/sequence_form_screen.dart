import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';

class SequenceFormScreen extends ConsumerStatefulWidget {
  const SequenceFormScreen({super.key});

  @override
  ConsumerState<SequenceFormScreen> createState() => _SequenceFormScreenState();
}

class _SequenceFormScreenState extends ConsumerState<SequenceFormScreen> {
  final _nameCtl = TextEditingController();
  final _descCtl = TextEditingController();
  final _goalCtl = TextEditingController();
  bool _saving = false;

  // Settings
  String _timezoneMode = 'contact';
  final _startTimeCtl = TextEditingController(text: '09:00');
  final _endTimeCtl = TextEditingController(text: '17:00');
  final List<bool> _sendDays = [true, true, true, true, true, false, false]; // Mon-Sun

  // Steps
  final List<Map<String, dynamic>> _steps = [];

  @override
  void dispose() {
    _nameCtl.dispose();
    _descCtl.dispose();
    _goalCtl.dispose();
    _startTimeCtl.dispose();
    _endTimeCtl.dispose();
    super.dispose();
  }

  void _addStep(String type) {
    setState(() {
      _steps.add({
        'type': type,
        'day_offset': _steps.isEmpty ? 0 : (_steps.last['day_offset'] as int) + 2,
        'time_of_day': '09:00',
        'subject_template': '',
        'body_template': '',
        'task_note': '',
      });
    });
  }

  void _removeStep(int index) {
    setState(() => _steps.removeAt(index));
  }

  Future<void> _save() async {
    if (_nameCtl.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Name is required')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      // Create sequence
      final res = await ApiClient.instance.dio.post(Endpoints.sequences, data: {
        'name': _nameCtl.text.trim(),
        'description': _descCtl.text.trim(),
        'goal': _goalCtl.text.trim(),
        'settings': {
          'timezoneMode': _timezoneMode,
          'sendWindow': {'start': _startTimeCtl.text, 'end': _endTimeCtl.text},
          'sendDays': {
            'mon': _sendDays[0], 'tue': _sendDays[1], 'wed': _sendDays[2],
            'thu': _sendDays[3], 'fri': _sendDays[4], 'sat': _sendDays[5], 'sun': _sendDays[6],
          },
        },
      });

      // If we have steps and got a sequence ID, create them
      final seqId = res.data['data']?['id'];
      if (seqId != null && _steps.isNotEmpty) {
        await ApiClient.instance.dio.post('${Endpoints.sequences}/$seqId/steps', data: {
          'steps': _steps.asMap().entries.map((e) => {
            ...e.value,
            'step_number': e.key + 1,
          }).toList(),
        });
      }

      if (mounted) {
        Navigator.pop(context, true);
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to create sequence')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  IconData _stepTypeIcon(String type) {
    switch (type) {
      case 'email': return Icons.email_outlined;
      case 'call': return Icons.phone_outlined;
      case 'linkedin_task': return Icons.business_outlined;
      default: return Icons.task_outlined;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    return Scaffold(
      appBar: AppBar(
        title: Text('New Sequence${_steps.isNotEmpty ? ' (${_steps.length} steps)' : ''}'),
        actions: [
          TextButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Save'),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Meta fields
          TextField(controller: _nameCtl,
              decoration: const InputDecoration(labelText: 'Sequence name', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          TextField(controller: _descCtl, maxLines: 2,
              decoration: const InputDecoration(labelText: 'Description', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          TextField(controller: _goalCtl,
              decoration: const InputDecoration(labelText: 'Goal', hintText: 'e.g. Book a demo', border: OutlineInputBorder())),

          const SizedBox(height: 24),

          // Settings
          ExpansionTile(
            title: Text('Settings', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
            initiallyExpanded: false,
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    DropdownButtonFormField<String>(
                      value: _timezoneMode,
                      decoration: const InputDecoration(labelText: 'Timezone mode'),
                      items: const [
                        DropdownMenuItem(value: 'contact', child: Text('Contact timezone')),
                        DropdownMenuItem(value: 'rep', child: Text('Rep timezone')),
                        DropdownMenuItem(value: 'fixed', child: Text('Fixed timezone')),
                      ],
                      onChanged: (v) => setState(() => _timezoneMode = v!),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(child: TextField(controller: _startTimeCtl,
                            decoration: const InputDecoration(labelText: 'Send from'))),
                        const Padding(padding: EdgeInsets.symmetric(horizontal: 8), child: Text('to')),
                        Expanded(child: TextField(controller: _endTimeCtl,
                            decoration: const InputDecoration(labelText: 'Send until'))),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text('Send days', style: theme.textTheme.bodySmall),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 4,
                      children: List.generate(7, (i) =>
                        FilterChip(
                          label: Text(dayLabels[i], style: const TextStyle(fontSize: 12)),
                          selected: _sendDays[i],
                          onSelected: (v) => setState(() => _sendDays[i] = v),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 16),

          // Steps
          Text('Steps', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          ...(_steps.asMap().entries.map((entry) {
            final i = entry.key;
            final step = entry.value;
            final type = step['type'] as String;
            return Card(
              margin: const EdgeInsets.only(bottom: 12),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        CircleAvatar(
                          radius: 14,
                          backgroundColor: theme.colorScheme.primaryContainer,
                          child: Text('${i + 1}', style: TextStyle(fontSize: 12, color: theme.colorScheme.onPrimaryContainer, fontWeight: FontWeight.bold)),
                        ),
                        const SizedBox(width: 8),
                        Icon(_stepTypeIcon(type), size: 18),
                        const SizedBox(width: 4),
                        Text(type.replaceAll('_', ' '), style: const TextStyle(fontWeight: FontWeight.w600)),
                        const Spacer(),
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            SizedBox(
                              width: 60,
                              child: TextField(
                                decoration: const InputDecoration(labelText: 'Day', isDense: true),
                                keyboardType: TextInputType.number,
                                controller: TextEditingController(text: '${step['day_offset']}'),
                                onChanged: (v) => step['day_offset'] = int.tryParse(v) ?? 0,
                              ),
                            ),
                            IconButton(icon: const Icon(Icons.delete_outline, size: 20, color: Colors.red),
                                onPressed: () => _removeStep(i)),
                          ],
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    if (type == 'email') ...[
                      TextField(
                        decoration: const InputDecoration(labelText: 'Subject', isDense: true),
                        controller: TextEditingController(text: step['subject_template']),
                        onChanged: (v) => step['subject_template'] = v,
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        decoration: const InputDecoration(labelText: 'Body', isDense: true),
                        maxLines: 3,
                        controller: TextEditingController(text: step['body_template']),
                        onChanged: (v) => step['body_template'] = v,
                      ),
                    ] else
                      TextField(
                        decoration: const InputDecoration(labelText: 'Task note', isDense: true),
                        controller: TextEditingController(text: step['task_note']),
                        onChanged: (v) => step['task_note'] = v,
                      ),
                  ],
                ),
              ),
            );
          })),

          // Add step buttons
          Wrap(
            spacing: 8,
            children: [
              ActionChip(
                avatar: const Icon(Icons.email_outlined, size: 16),
                label: const Text('Email'),
                onPressed: () => _addStep('email'),
              ),
              ActionChip(
                avatar: const Icon(Icons.phone_outlined, size: 16),
                label: const Text('Call'),
                onPressed: () => _addStep('call'),
              ),
              ActionChip(
                avatar: const Icon(Icons.business_outlined, size: 16),
                label: const Text('LinkedIn'),
                onPressed: () => _addStep('linkedin_task'),
              ),
            ],
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}
