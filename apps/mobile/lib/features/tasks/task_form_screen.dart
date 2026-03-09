import 'dart:async';
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
const _priorityColors = {
  'high': Colors.red,
  'medium': Colors.orange,
  'low': Colors.grey,
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
  final _entitySearchController = TextEditingController();
  String _priority = 'medium';
  String _status = 'pending';
  bool _loading = false;
  DateTime? _dueDate;

  // Assignee
  String? _assigneeId;
  String? _assigneeName;
  List<Map<String, dynamic>> _users = [];
  bool _loadingUsers = false;

  // Entity linking
  String? _linkedEntityType; // 'contact' or 'company'
  String? _linkedEntityId;
  String? _linkedEntityName;
  List<Map<String, dynamic>> _entitySearchResults = [];
  bool _searchingEntities = false;
  Timer? _entitySearchDebounce;

  @override
  void initState() {
    super.initState();
    _loadUsers();
    if (widget.task != null) {
      final t = widget.task!;
      _titleController.text = t['title'] ?? '';
      _descriptionController.text = t['description'] ?? '';
      _priority = t['priority'] ?? 'medium';
      _status = t['status'] ?? 'pending';
      if (t['due_date'] != null) {
        _dueDate = DateTime.tryParse(t['due_date'].toString());
      }
      // Restore assignee
      _assigneeId = t['assignee_id'] ?? t['assigneeId'];
      final assignee = t['assignee'];
      if (assignee is Map) {
        _assigneeName = assignee['fullName'] ??
            assignee['full_name'] ??
            '${assignee['firstName'] ?? assignee['first_name'] ?? ''} ${assignee['lastName'] ?? assignee['last_name'] ?? ''}'
                .trim();
      }
      _assigneeName ??= t['assignee_name'] ?? t['assigneeName'];

      // Restore linked entity
      _restoreLinkedEntity(t);
    }
  }

  void _restoreLinkedEntity(Map<String, dynamic> t) {
    final deal = t['deal'];
    final contact = t['contact'];
    final company = t['company'];

    if (contact is Map && contact['id'] != null) {
      _linkedEntityType = 'contact';
      _linkedEntityId = contact['id'];
      _linkedEntityName =
          contact['name'] ?? contact['fullName'] ?? contact['full_name'];
    } else if (company is Map && company['id'] != null) {
      _linkedEntityType = 'company';
      _linkedEntityId = company['id'];
      _linkedEntityName = company['name'];
    } else if (t['contact_id'] != null || t['contactId'] != null) {
      _linkedEntityType = 'contact';
      _linkedEntityId = t['contact_id'] ?? t['contactId'];
      _linkedEntityName = t['contact_name'] ?? t['contactName'];
    } else if (t['company_id'] != null || t['companyId'] != null) {
      _linkedEntityType = 'company';
      _linkedEntityId = t['company_id'] ?? t['companyId'];
      _linkedEntityName = t['company_name'] ?? t['companyName'];
    } else if (t['deal_id'] != null || t['dealId'] != null) {
      _linkedEntityType = 'deal';
      _linkedEntityId = t['deal_id'] ?? t['dealId'];
      _linkedEntityName = t['deal_name'] ?? t['dealName'];
    } else {
      _linkedEntityType = t['linked_entity_type'] ?? t['linkedEntityType'];
      _linkedEntityId = t['linked_entity_id'] ?? t['linkedEntityId'];
      _linkedEntityName = t['linked_entity_name'] ?? t['linkedEntityName'];
    }
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    _entitySearchController.dispose();
    _entitySearchDebounce?.cancel();
    super.dispose();
  }

  Future<void> _loadUsers() async {
    setState(() => _loadingUsers = true);
    try {
      final res = await ApiClient.instance.dio
          .get(Endpoints.users, queryParameters: {'limit': '100'});
      final data = res.data['data'];
      final items = data is List
          ? data
          : (data is Map ? (data['items'] ?? data['users'] ?? []) : []);
      if (mounted) {
        setState(
            () => _users = List<Map<String, dynamic>>.from(items));
      }
    } catch (_) {
      // Silently fail - assignee field will just be empty
    } finally {
      if (mounted) setState(() => _loadingUsers = false);
    }
  }

  void _onEntitySearchChanged(String query) {
    _entitySearchDebounce?.cancel();
    if (query.trim().length < 2) {
      setState(() => _entitySearchResults = []);
      return;
    }
    _entitySearchDebounce = Timer(const Duration(milliseconds: 350), () {
      _searchEntities(query.trim());
    });
  }

  Future<void> _searchEntities(String query) async {
    setState(() => _searchingEntities = true);
    try {
      final results = <Map<String, dynamic>>[];

      // Search contacts and companies in parallel
      final futures = await Future.wait([
        ApiClient.instance.dio.get(Endpoints.contacts,
            queryParameters: {'search': query, 'limit': '5'}),
        ApiClient.instance.dio.get(Endpoints.companies,
            queryParameters: {'search': query, 'limit': '5'}),
      ]);

      // Parse contacts
      final contactData = futures[0].data['data'];
      final contactItems = contactData is List
          ? contactData
          : (contactData is Map
              ? (contactData['items'] ?? contactData['contacts'] ?? [])
              : []);
      for (final c in contactItems) {
        final name = c['fullName'] ??
            c['full_name'] ??
            c['name'] ??
            '${c['firstName'] ?? c['first_name'] ?? ''} ${c['lastName'] ?? c['last_name'] ?? ''}'
                .trim();
        results.add({
          'type': 'contact',
          'id': c['id'],
          'name': name,
          'icon': Icons.person_outline,
        });
      }

      // Parse companies
      final companyData = futures[1].data['data'];
      final companyItems = companyData is List
          ? companyData
          : (companyData is Map
              ? (companyData['items'] ?? companyData['companies'] ?? [])
              : []);
      for (final c in companyItems) {
        results.add({
          'type': 'company',
          'id': c['id'],
          'name': c['name'] ?? 'Unnamed',
          'icon': Icons.business_outlined,
        });
      }

      if (mounted) {
        setState(() => _entitySearchResults = results);
      }
    } catch (_) {
      // Silently fail
    } finally {
      if (mounted) setState(() => _searchingEntities = false);
    }
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
      if (_assigneeId != null) {
        data['assignee_id'] = _assigneeId;
      }
      if (_linkedEntityId != null && _linkedEntityType != null) {
        // Send the specific typed foreign key the API expects
        if (_linkedEntityType == 'contact') {
          data['contact_id'] = _linkedEntityId;
        } else if (_linkedEntityType == 'company') {
          data['company_id'] = _linkedEntityId;
        } else if (_linkedEntityType == 'deal') {
          data['deal_id'] = _linkedEntityId;
        }
        // Also send generic fields in case the API uses those
        data['linked_entity_type'] = _linkedEntityType;
        data['linked_entity_id'] = _linkedEntityId;
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

  String _userDisplayName(Map<String, dynamic> u) {
    final full = u['fullName'] ?? u['full_name'];
    if (full is String && full.isNotEmpty) return full;
    final first = u['firstName'] ?? u['first_name'] ?? '';
    final last = u['lastName'] ?? u['last_name'] ?? '';
    final name = '$first $last'.trim();
    return name.isNotEmpty ? name : (u['email'] ?? 'Unknown');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

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
              // Title
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
              const SizedBox(height: 20),

              // Priority - button style selector
              Text('Priority',
                  style: theme.textTheme.titleSmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              const SizedBox(height: 8),
              Row(
                children: _priorities.map((p) {
                  final isSelected = _priority == p;
                  final color = _priorityColors[p] ?? Colors.grey;
                  return Expanded(
                    child: Padding(
                      padding: EdgeInsets.only(
                          right: p != _priorities.last ? 8 : 0),
                      child: Material(
                        color: isSelected
                            ? color.withOpacity(0.15)
                            : theme.colorScheme.surfaceVariant
                                .withOpacity(0.3),
                        borderRadius: BorderRadius.circular(10),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(10),
                          onTap: () => setState(() => _priority = p),
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                color:
                                    isSelected ? color : Colors.transparent,
                                width: 2,
                              ),
                            ),
                            child: Column(
                              children: [
                                Icon(
                                  Icons.flag,
                                  color: isSelected
                                      ? color
                                      : theme
                                          .colorScheme.onSurfaceVariant,
                                  size: 20,
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  _priorityLabels[p] ?? p,
                                  style: TextStyle(
                                    color: isSelected
                                        ? color
                                        : theme
                                            .colorScheme.onSurfaceVariant,
                                    fontWeight: isSelected
                                        ? FontWeight.bold
                                        : FontWeight.normal,
                                    fontSize: 13,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  );
                }).toList(),
              ),
              const SizedBox(height: 20),

              // Status
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

              // Due date
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
              const Divider(),

              // Assignee
              const SizedBox(height: 8),
              Text('Assignee',
                  style: theme.textTheme.titleSmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              const SizedBox(height: 8),
              _loadingUsers
                  ? const Padding(
                      padding: EdgeInsets.symmetric(vertical: 8),
                      child: LinearProgressIndicator(),
                    )
                  : DropdownButtonFormField<String?>(
                      value: _assigneeId,
                      decoration: const InputDecoration(
                        hintText: 'Unassigned',
                        prefixIcon: Icon(Icons.person_outline),
                      ),
                      items: [
                        const DropdownMenuItem<String?>(
                          value: null,
                          child: Text('Unassigned'),
                        ),
                        ..._users.map((u) => DropdownMenuItem<String?>(
                              value: u['id'] as String?,
                              child: Text(_userDisplayName(u)),
                            )),
                      ],
                      onChanged: (v) {
                        setState(() {
                          _assigneeId = v;
                          if (v != null) {
                            final user = _users.firstWhere(
                              (u) => u['id'] == v,
                              orElse: () => <String, dynamic>{},
                            );
                            _assigneeName = _userDisplayName(user);
                          } else {
                            _assigneeName = null;
                          }
                        });
                      },
                    ),
              const SizedBox(height: 16),
              const Divider(),

              // Linked entity
              const SizedBox(height: 8),
              Text('Link to Contact or Company',
                  style: theme.textTheme.titleSmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              const SizedBox(height: 8),

              if (_linkedEntityId != null && _linkedEntityName != null) ...[
                // Show selected entity
                Card(
                  child: ListTile(
                    leading: Icon(
                      _linkedEntityType == 'company'
                          ? Icons.business_outlined
                          : _linkedEntityType == 'deal'
                              ? Icons.handshake_outlined
                              : Icons.person_outline,
                      color: theme.colorScheme.primary,
                    ),
                    title: Text(_linkedEntityName!),
                    subtitle: Text(
                      _linkedEntityType?.replaceRange(
                              0, 1, _linkedEntityType![0].toUpperCase()) ??
                          '',
                      style: theme.textTheme.bodySmall,
                    ),
                    trailing: IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () {
                        setState(() {
                          _linkedEntityType = null;
                          _linkedEntityId = null;
                          _linkedEntityName = null;
                          _entitySearchController.clear();
                          _entitySearchResults = [];
                        });
                      },
                    ),
                  ),
                ),
              ] else ...[
                // Search field
                TextFormField(
                  controller: _entitySearchController,
                  decoration: InputDecoration(
                    hintText: 'Search contacts or companies...',
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: _searchingEntities
                        ? const Padding(
                            padding: EdgeInsets.all(12),
                            child: SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                          )
                        : _entitySearchController.text.isNotEmpty
                            ? IconButton(
                                icon: const Icon(Icons.clear),
                                onPressed: () {
                                  _entitySearchController.clear();
                                  setState(
                                      () => _entitySearchResults = []);
                                },
                              )
                            : null,
                  ),
                  onChanged: _onEntitySearchChanged,
                ),

                // Search results
                if (_entitySearchResults.isNotEmpty)
                  Container(
                    constraints: const BoxConstraints(maxHeight: 200),
                    margin: const EdgeInsets.only(top: 4),
                    decoration: BoxDecoration(
                      border: Border.all(
                          color: theme.colorScheme.outlineVariant),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: ListView.separated(
                      shrinkWrap: true,
                      itemCount: _entitySearchResults.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final entity = _entitySearchResults[index];
                        return ListTile(
                          dense: true,
                          leading: Icon(
                            entity['icon'] as IconData,
                            size: 20,
                            color: theme.colorScheme.primary,
                          ),
                          title: Text(entity['name'] ?? ''),
                          subtitle: Text(
                            (entity['type'] as String).replaceRange(
                                0,
                                1,
                                (entity['type'] as String)[0]
                                    .toUpperCase()),
                            style: theme.textTheme.bodySmall,
                          ),
                          onTap: () {
                            setState(() {
                              _linkedEntityType = entity['type'];
                              _linkedEntityId = entity['id'];
                              _linkedEntityName = entity['name'];
                              _entitySearchController.clear();
                              _entitySearchResults = [];
                            });
                          },
                        );
                      },
                    ),
                  ),
              ],

              const SizedBox(height: 24),

              // Submit button
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
