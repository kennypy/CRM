import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';

const _activityTypes = ['call', 'email', 'meeting', 'note', 'task'];

const _typeLabels = {
  'call': 'Call',
  'email': 'Email',
  'meeting': 'Meeting',
  'note': 'Note',
  'task': 'Task',
};

const _typeIcons = {
  'call': Icons.phone,
  'email': Icons.email_outlined,
  'meeting': Icons.people_outlined,
  'note': Icons.note_outlined,
  'task': Icons.task_alt,
};

const _directions = ['inbound', 'outbound'];

const _directionLabels = {
  'inbound': 'Inbound',
  'outbound': 'Outbound',
};

class ActivityFormScreen extends ConsumerStatefulWidget {
  const ActivityFormScreen({super.key});

  @override
  ConsumerState<ActivityFormScreen> createState() => _ActivityFormScreenState();
}

class _ActivityFormScreenState extends ConsumerState<ActivityFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _subjectController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _durationController = TextEditingController();
  String _type = 'call';
  String _direction = 'outbound';
  DateTime _dateTime = DateTime.now();
  bool _loading = false;

  @override
  void dispose() {
    _subjectController.dispose();
    _descriptionController.dispose();
    _durationController.dispose();
    super.dispose();
  }

  bool get _showDirection => _type == 'call' || _type == 'email';
  bool get _showDuration => _type == 'call' || _type == 'meeting';

  Future<void> _pickDateTime() async {
    final pickedDate = await showDatePicker(
      context: context,
      initialDate: _dateTime,
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (pickedDate == null || !mounted) return;

    final pickedTime = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_dateTime),
    );
    if (pickedTime == null || !mounted) return;

    setState(() {
      _dateTime = DateTime(
        pickedDate.year,
        pickedDate.month,
        pickedDate.day,
        pickedTime.hour,
        pickedTime.minute,
      );
    });
  }

  Future<void> _handleSubmit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _loading = true);

    try {
      final data = <String, dynamic>{
        'type': _type,
        'subject': _subjectController.text.trim(),
        'occurredAt': _dateTime.toIso8601String(),
      };
      if (_descriptionController.text.isNotEmpty) {
        data['body'] = _descriptionController.text.trim();
      }
      if (_showDirection) {
        data['direction'] = _direction;
      }
      if (_showDuration && _durationController.text.isNotEmpty) {
        data['duration'] = int.tryParse(_durationController.text) ?? 0;
      }

      await ApiClient.instance.dio.post(Endpoints.activities, data: data);
      if (mounted) context.pop(true);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to create activity')),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _formatDateTime(DateTime dt) {
    final date = '${dt.month}/${dt.day}/${dt.year}';
    final hour = dt.hour == 0 ? 12 : (dt.hour > 12 ? dt.hour - 12 : dt.hour);
    final minute = dt.minute.toString().padLeft(2, '0');
    final period = dt.hour >= 12 ? 'PM' : 'AM';
    return '$date $hour:$minute $period';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('New Activity')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Type dropdown
              DropdownButtonFormField<String>(
                value: _type,
                decoration: const InputDecoration(
                  labelText: 'Type',
                  prefixIcon: Icon(Icons.category),
                ),
                items: _activityTypes.map((t) => DropdownMenuItem(
                  value: t,
                  child: Row(
                    children: [
                      Icon(_typeIcons[t], size: 20),
                      const SizedBox(width: 8),
                      Text(_typeLabels[t] ?? t),
                    ],
                  ),
                )).toList(),
                onChanged: (v) { if (v != null) setState(() => _type = v); },
              ),
              const SizedBox(height: 16),

              // Subject
              TextFormField(
                controller: _subjectController,
                decoration: const InputDecoration(
                  labelText: 'Subject *',
                  prefixIcon: Icon(Icons.short_text),
                ),
                textInputAction: TextInputAction.next,
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 16),

              // Description
              TextFormField(
                controller: _descriptionController,
                decoration: const InputDecoration(
                  labelText: 'Description',
                  alignLabelWithHint: true,
                  prefixIcon: Icon(Icons.notes),
                ),
                maxLines: 4,
                textInputAction: TextInputAction.newline,
              ),
              const SizedBox(height: 16),

              // Date/Time picker
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.calendar_today),
                title: Text(_formatDateTime(_dateTime)),
                subtitle: const Text('Date & time'),
                trailing: const Icon(Icons.chevron_right, size: 20),
                onTap: _pickDateTime,
              ),
              const SizedBox(height: 16),

              // Direction (for calls/emails)
              if (_showDirection) ...[
                DropdownButtonFormField<String>(
                  value: _direction,
                  decoration: const InputDecoration(
                    labelText: 'Direction',
                    prefixIcon: Icon(Icons.swap_horiz),
                  ),
                  items: _directions.map((d) => DropdownMenuItem(
                    value: d,
                    child: Text(_directionLabels[d] ?? d),
                  )).toList(),
                  onChanged: (v) { if (v != null) setState(() => _direction = v); },
                ),
                const SizedBox(height: 16),
              ],

              // Duration (for calls/meetings)
              if (_showDuration) ...[
                TextFormField(
                  controller: _durationController,
                  decoration: const InputDecoration(
                    labelText: 'Duration (minutes)',
                    prefixIcon: Icon(Icons.timer_outlined),
                  ),
                  keyboardType: TextInputType.number,
                  textInputAction: TextInputAction.done,
                ),
                const SizedBox(height: 16),
              ],

              const SizedBox(height: 8),

              // Submit button
              SizedBox(
                height: 48,
                child: ElevatedButton(
                  onPressed: _loading ? null : _handleSubmit,
                  child: _loading
                      ? const SizedBox(
                          height: 20, width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Text('Create Activity'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
