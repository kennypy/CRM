import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';

const _priorities = ['high', 'medium', 'low'];
const _priorityLabels = {
  'high': 'High',
  'medium': 'Medium',
  'low': 'Low',
};

const _statuses = ['pending', 'in_progress', 'completed'];
const _statusLabels = {
  'pending': 'Pending',
  'in_progress': 'In Progress',
  'completed': 'Completed',
};

class TaskFormScreen extends ConsumerStatefulWidget {
  final Map<String, dynamic>? task;

  const TaskFormScreen({super.key, this.task});

  bool get isEditing => task != null;

  @override
  ConsumerState<TaskFormScreen> createState() => _TaskFormScreenState();
}

class _TaskFormScreenState extends ConsumerState<TaskFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _titleController = TextEditingController();
  final _descriptionController = TextEditingController();
  String _priority = 'medium';
  String _status = 'pending';
  bool _loading = false;
  DateTime? _dueDate;

  @override
  void initState() {
    super.initState();
    if (widget.task != null) {
      final t = widget.task!;
      _titleController.text = t['title'] ?? '';
      _descriptionController.text = t['description'] ?? '';
      _priority = t['priority'] ?? 'medium';
      _status = t['status'] ?? 'pending';
      if (t['due_date'] != null) {
        _dueDate = DateTime.tryParse(t['due_date'].toString());
      }
    }
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _pickDueDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _dueDate ?? DateTime.now().add(const Duration(days: 7)),
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: DateTime.now().add(const Duration(days: 365 * 3)),
    );
    if (picked != null) setState(() => _dueDate = picked);
  }

  Future<void> _handleSubmit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _loading = true);

    try {
      final data = <String, dynamic>{
        'title': _titleController.text.trim(),
        'priority': _priority,
        'status': _status,
      };
      if (_descriptionController.text.isNotEmpty) {
        data['description'] = _descriptionController.text.trim();
      }
      if (_dueDate != null) {
        data['due_date'] = _dueDate!.toIso8601String().split('T')[0];
      }

      if (widget.isEditing) {
        await ApiClient.instance.dio.patch(
          '${Endpoints.tasks}/${widget.task!['id']}',
          data: data,
        );
      } else {
        await ApiClient.instance.dio.post(Endpoints.tasks, data: data);
      }
      if (mounted) context.pop(true);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              widget.isEditing
                  ? 'Failed to update task'
                  : 'Failed to create task',
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.isEditing ? 'Edit Task' : 'New Task'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                controller: _titleController,
                decoration: const InputDecoration(
                  labelText: 'Title *',
                  prefixIcon: Icon(Icons.task_alt),
                ),
                textInputAction: TextInputAction.next,
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 16),

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

              DropdownButtonFormField<String>(
                value: _priority,
                decoration: const InputDecoration(
                  labelText: 'Priority',
                  prefixIcon: Icon(Icons.flag),
                ),
                items: _priorities
                    .map((p) => DropdownMenuItem(
                          value: p,
                          child: Text(_priorityLabels[p] ?? p),
                        ))
                    .toList(),
                onChanged: (v) {
                  if (v != null) setState(() => _priority = v);
                },
              ),
              const SizedBox(height: 16),

              DropdownButtonFormField<String>(
                value: _status,
                decoration: const InputDecoration(
                  labelText: 'Status',
                  prefixIcon: Icon(Icons.info_outline),
                ),
                items: _statuses
                    .map((s) => DropdownMenuItem(
                          value: s,
                          child: Text(_statusLabels[s] ?? s),
                        ))
                    .toList(),
                onChanged: (v) {
                  if (v != null) setState(() => _status = v);
                },
              ),
              const SizedBox(height: 16),

              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.calendar_today),
                title: Text(_dueDate != null
                    ? 'Due: ${_dueDate!.toIso8601String().split('T')[0]}'
                    : 'Set due date'),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (_dueDate != null)
                      IconButton(
                        icon: const Icon(Icons.clear, size: 20),
                        onPressed: () => setState(() => _dueDate = null),
                      ),
                    const Icon(Icons.chevron_right, size: 20),
                  ],
                ),
                onTap: _pickDueDate,
              ),
              const SizedBox(height: 24),

              SizedBox(
                height: 48,
                child: ElevatedButton(
                  onPressed: _loading ? null : _handleSubmit,
                  child: _loading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white),
                        )
                      : Text(widget.isEditing ? 'Update Task' : 'Create Task'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
