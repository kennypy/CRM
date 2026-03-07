import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';

const _stages = ['lead', 'qualified', 'discovery', 'proposal', 'negotiation', 'closed_won', 'closed_lost'];
const _stageLabels = {
  'lead': 'Lead',
  'qualified': 'Qualified',
  'discovery': 'Discovery',
  'proposal': 'Proposal',
  'negotiation': 'Negotiation',
  'closed_won': 'Won',
  'closed_lost': 'Lost',
};

class DealFormScreen extends ConsumerStatefulWidget {
  const DealFormScreen({super.key});

  @override
  ConsumerState<DealFormScreen> createState() => _DealFormScreenState();
}

class _DealFormScreenState extends ConsumerState<DealFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _valueController = TextEditingController();
  final _notesController = TextEditingController();
  String _stage = 'lead';
  bool _loading = false;
  DateTime? _closeDate;

  @override
  void dispose() {
    _nameController.dispose();
    _valueController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _pickCloseDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _closeDate ?? DateTime.now().add(const Duration(days: 30)),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365 * 3)),
    );
    if (picked != null) setState(() => _closeDate = picked);
  }

  Future<void> _handleSubmit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _loading = true);

    try {
      final data = <String, dynamic>{
        'name': _nameController.text.trim(),
        'stage': _stage,
      };
      if (_valueController.text.isNotEmpty) {
        data['value'] = double.tryParse(_valueController.text) ?? 0;
      }
      if (_closeDate != null) {
        data['closeDate'] = _closeDate!.toIso8601String().split('T')[0];
      }
      if (_notesController.text.isNotEmpty) {
        data['notes'] = _notesController.text.trim();
      }

      await ApiClient.instance.dio.post(Endpoints.deals, data: data);
      if (mounted) context.pop(true);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to create deal')),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('New Deal')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                controller: _nameController,
                decoration: const InputDecoration(
                  labelText: 'Deal name *',
                  prefixIcon: Icon(Icons.handshake),
                ),
                textInputAction: TextInputAction.next,
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 16),

              TextFormField(
                controller: _valueController,
                decoration: const InputDecoration(
                  labelText: 'Value',
                  prefixIcon: Icon(Icons.attach_money),
                ),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 16),

              DropdownButtonFormField<String>(
                value: _stage,
                decoration: const InputDecoration(
                  labelText: 'Stage',
                  prefixIcon: Icon(Icons.flag),
                ),
                items: _stages.map((s) => DropdownMenuItem(
                  value: s,
                  child: Text(_stageLabels[s] ?? s),
                )).toList(),
                onChanged: (v) { if (v != null) setState(() => _stage = v); },
              ),
              const SizedBox(height: 16),

              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.calendar_today),
                title: Text(_closeDate != null
                    ? 'Close: ${_closeDate!.toIso8601String().split('T')[0]}'
                    : 'Set close date'),
                trailing: const Icon(Icons.chevron_right, size: 20),
                onTap: _pickCloseDate,
              ),
              const SizedBox(height: 16),

              TextFormField(
                controller: _notesController,
                decoration: const InputDecoration(
                  labelText: 'Notes',
                  alignLabelWithHint: true,
                ),
                maxLines: 3,
              ),
              const SizedBox(height: 24),

              SizedBox(
                height: 48,
                child: ElevatedButton(
                  onPressed: _loading ? null : _handleSubmit,
                  child: _loading
                      ? const SizedBox(
                          height: 20, width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Text('Create Deal'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
