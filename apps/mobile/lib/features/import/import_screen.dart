import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/error_view.dart';

// ---------------------------------------------------------------------------
// Import wizard steps
// ---------------------------------------------------------------------------
enum _ImportStep { upload, mapping, processing, done }

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
class ImportScreen extends ConsumerStatefulWidget {
  const ImportScreen({super.key});

  @override
  ConsumerState<ImportScreen> createState() => _ImportScreenState();
}

class _ImportScreenState extends ConsumerState<ImportScreen> {
  // ---- wizard state ----
  _ImportStep _step = _ImportStep.upload;

  // Step 1 – Upload
  String _entityType = 'contact';
  String? _pickedFileName;
  String? _pickedFileExtension;
  List<String> _fileColumns = [];

  // Step 2 – Mapping
  late Map<String, String?> _columnMapping; // fileCol -> crmField | null

  // Step 3 – Processing
  int _processedRows = 0;
  int _totalRows = 0;
  Timer? _processingTimer;

  // Step 4 – Done
  String _importStatus = 'completed';
  int _createdCount = 0;
  int _updatedCount = 0;
  int _skippedCount = 0;
  int _errorCount = 0;
  List<String> _errorDetails = [];

  // Recent imports
  List<Map<String, dynamic>> _jobs = [];
  bool _loadingJobs = true;

  // ---- constants ----
  static const _entityTypes = {
    'contact': 'Contacts',
    'company': 'Companies',
    'deal': 'Deals',
    'activity': 'Activities',
    'task': 'Tasks',
  };

  static const _crmFields = {
    'contact': [
      'first_name',
      'last_name',
      'email',
      'phone',
      'title',
      'company',
      'linkedin_url',
    ],
    'company': [
      'name',
      'domain',
      'industry',
      'employee_count',
      'revenue',
      'phone',
      'address',
    ],
    'deal': ['name', 'value', 'stage', 'close_date', 'company', 'owner'],
    'activity': [
      'type',
      'title',
      'description',
      'date',
      'contact',
      'company',
    ],
    'task': [
      'title',
      'description',
      'due_date',
      'priority',
      'status',
      'assignee',
    ],
  };

  static const _supportedExtensions = ['csv', 'xlsx', 'json'];

  // Demo data shown when the API returns no imports
  static final List<Map<String, dynamic>> _demoImports = [
    {
      'fileName': 'leads_q1.csv',
      'entity_type': 'contact',
      'status': 'completed',
      'createdRows': 142,
      'updatedRows': 8,
      'skippedRows': 3,
      'errorRows': 0,
    },
    {
      'fileName': 'companies_export.xlsx',
      'entity_type': 'company',
      'status': 'completed',
      'createdRows': 56,
      'updatedRows': 12,
      'skippedRows': 0,
      'errorRows': 1,
    },
    {
      'fileName': 'deals_march.json',
      'entity_type': 'deal',
      'status': 'failed',
      'createdRows': 0,
      'updatedRows': 0,
      'skippedRows': 0,
      'errorRows': 34,
    },
  ];

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  @override
  void initState() {
    super.initState();
    _loadJobs();
  }

  @override
  void dispose() {
    _processingTimer?.cancel();
    super.dispose();
  }

  // --------------------------------------------------------------------------
  // Data loading
  // --------------------------------------------------------------------------

  Future<void> _loadJobs() async {
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.import_);
      final data = res.data is List ? res.data : (res.data['data'] ?? []);
      if (mounted) {
        setState(() {
          _jobs = List<Map<String, dynamic>>.from(data);
          if (_jobs.isEmpty) _jobs = List.from(_demoImports);
        });
      }
    } catch (_) {
      if (mounted) setState(() => _jobs = List.from(_demoImports));
    } finally {
      if (mounted) setState(() => _loadingJobs = false);
    }
  }

  // --------------------------------------------------------------------------
  // Step transitions
  // --------------------------------------------------------------------------

  void _goToStep(_ImportStep step) {
    setState(() => _step = step);
  }

  /// Simulates picking a file. In a real app this would use file_picker.
  void _pickFile() {
    // Placeholder: simulate a picked CSV file with sample columns.
    setState(() {
      _pickedFileName = 'import_data.csv';
      _pickedFileExtension = 'csv';
      _fileColumns = [
        'First Name',
        'Last Name',
        'Email Address',
        'Phone Number',
        'Job Title',
        'Company Name',
        'LinkedIn',
        'Notes',
      ];
    });
  }

  void _startMapping() {
    if (_pickedFileName == null) return;
    final crmList = _crmFields[_entityType] ?? [];
    _columnMapping = {};
    for (final col in _fileColumns) {
      _columnMapping[col] = _autoMap(col, crmList);
    }
    _goToStep(_ImportStep.mapping);
  }

  /// Naive auto-mapping: lowercase both sides and find substring match.
  String? _autoMap(String fileCol, List<String> crmList) {
    final lc = fileCol.toLowerCase().replaceAll(' ', '_');
    for (final field in crmList) {
      if (lc == field || lc.contains(field) || field.contains(lc)) {
        return field;
      }
    }
    // Heuristic matches
    final heuristics = <String, String>{
      'email_address': 'email',
      'phone_number': 'phone',
      'job_title': 'title',
      'company_name': 'company',
      'company': 'company',
      'linkedin': 'linkedin_url',
    };
    final match = heuristics[lc];
    if (match != null && crmList.contains(match)) return match;
    return null;
  }

  void _startProcessing() {
    _totalRows = 150; // simulated
    _processedRows = 0;
    _goToStep(_ImportStep.processing);

    _processingTimer = Timer.periodic(const Duration(milliseconds: 80), (t) {
      if (!mounted) {
        t.cancel();
        return;
      }
      setState(() {
        _processedRows += 3;
        if (_processedRows >= _totalRows) {
          _processedRows = _totalRows;
          t.cancel();
          _finishProcessing();
        }
      });
    });
  }

  void _finishProcessing() {
    // Simulated results
    _importStatus = 'completed';
    _createdCount = 128;
    _updatedCount = 14;
    _skippedCount = 5;
    _errorCount = 3;
    _errorDetails = [
      'Row 42: missing required field "email"',
      'Row 87: invalid date format in "close_date"',
      'Row 131: duplicate record detected',
    ];
    _goToStep(_ImportStep.done);
  }

  void _resetWizard() {
    _processingTimer?.cancel();
    setState(() {
      _step = _ImportStep.upload;
      _pickedFileName = null;
      _pickedFileExtension = null;
      _fileColumns = [];
      _processedRows = 0;
      _totalRows = 0;
      _errorDetails = [];
    });
    _loadJobs();
  }

  // --------------------------------------------------------------------------
  // Build
  // --------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Import'),
        leading: _step != _ImportStep.upload
            ? IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () {
                  if (_step == _ImportStep.mapping) {
                    _goToStep(_ImportStep.upload);
                  } else if (_step == _ImportStep.done) {
                    _resetWizard();
                  }
                },
              )
            : null,
      ),
      body: Column(
        children: [
          _buildStepIndicator(theme),
          Expanded(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 300),
              child: _buildCurrentStep(theme),
            ),
          ),
        ],
      ),
    );
  }

  // --------------------------------------------------------------------------
  // Step indicator (4 dots)
  // --------------------------------------------------------------------------

  Widget _buildStepIndicator(ThemeData theme) {
    const labels = ['Upload', 'Mapping', 'Processing', 'Done'];
    final currentIndex = _ImportStep.values.indexOf(_step);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      child: Row(
        children: List.generate(labels.length * 2 - 1, (raw) {
          // Even indices = dot/label, odd indices = connector line
          if (raw.isOdd) {
            final beforeIndex = raw ~/ 2;
            return Expanded(
              child: Container(
                height: 2,
                margin: const EdgeInsets.only(bottom: 16),
                color: currentIndex > beforeIndex
                    ? theme.colorScheme.primary
                    : theme.colorScheme.outlineVariant,
              ),
            );
          }

          final i = raw ~/ 2;
          final isCompleted = i < currentIndex;
          final isCurrent = i == currentIndex;
          final color = isCompleted || isCurrent
              ? theme.colorScheme.primary
              : theme.colorScheme.outlineVariant;

          return Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: isCurrent ? 28 : 22,
                height: isCurrent ? 28 : 22,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: isCurrent || isCompleted ? color : Colors.transparent,
                  border: Border.all(color: color, width: 2),
                ),
                child: Center(
                  child: isCompleted
                      ? const Icon(Icons.check, size: 14, color: Colors.white)
                      : Text(
                          '${i + 1}',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                            color: isCurrent ? Colors.white : color,
                          ),
                        ),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                labels[i],
                style: theme.textTheme.labelSmall?.copyWith(
                  color: color,
                  fontWeight: isCurrent ? FontWeight.bold : FontWeight.normal,
                ),
              ),
            ],
          );
        }),
      ),
    );
  }

  Widget _buildCurrentStep(ThemeData theme) {
    switch (_step) {
      case _ImportStep.upload:
        return _buildUploadStep(theme);
      case _ImportStep.mapping:
        return _buildMappingStep(theme);
      case _ImportStep.processing:
        return _buildProcessingStep(theme);
      case _ImportStep.done:
        return _buildDoneStep(theme);
    }
  }

  // --------------------------------------------------------------------------
  // Step 1 – Upload
  // --------------------------------------------------------------------------

  Widget _buildUploadStep(ThemeData theme) {
    return ListView(
      key: const ValueKey('upload'),
      padding: const EdgeInsets.all(16),
      children: [
        // Entity type selector
        Text('Entity Type',
            style: theme.textTheme.titleSmall
                ?.copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          children: _entityTypes.entries
              .map((e) => ChoiceChip(
                    label: Text(e.value),
                    selected: _entityType == e.key,
                    onSelected: (_) => setState(() => _entityType = e.key),
                  ))
              .toList(),
        ),
        const SizedBox(height: 24),

        // File upload area
        Text('Upload File',
            style: theme.textTheme.titleSmall
                ?.copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        InkWell(
          onTap: _pickFile,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 16),
            decoration: BoxDecoration(
              border: Border.all(
                color: theme.colorScheme.outlineVariant,
                width: 2,
                strokeAlign: BorderSide.strokeAlignInside,
              ),
              borderRadius: BorderRadius.circular(12),
              color: theme.colorScheme.surfaceContainerLowest,
            ),
            child: Column(
              children: [
                Icon(Icons.cloud_upload_outlined,
                    size: 48, color: theme.colorScheme.primary),
                const SizedBox(height: 12),
                if (_pickedFileName != null) ...[
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.insert_drive_file,
                          size: 20, color: theme.colorScheme.primary),
                      const SizedBox(width: 8),
                      Text(_pickedFileName!,
                          style: theme.textTheme.bodyMedium
                              ?.copyWith(fontWeight: FontWeight.w600)),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${_fileColumns.length} columns detected',
                    style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant),
                  ),
                ] else ...[
                  Text('Tap to select a file',
                      style: theme.textTheme.bodyMedium
                          ?.copyWith(fontWeight: FontWeight.w500)),
                  const SizedBox(height: 4),
                  Text(
                    'Supported: ${_supportedExtensions.map((e) => '.${e.toUpperCase()}').join(', ')}',
                    style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant),
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),

        // Next button
        if (_pickedFileName != null)
          FilledButton.icon(
            onPressed: _startMapping,
            icon: const Icon(Icons.arrow_forward),
            label: const Text('Continue to Mapping'),
          ),

        const SizedBox(height: 32),

        // Recent imports
        Text('Recent Imports',
            style: theme.textTheme.titleSmall
                ?.copyWith(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        if (_loadingJobs)
          const Center(child: CircularProgressIndicator())
        else if (_jobs.isEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text('No imports yet',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
            ),
          )
        else
          ..._jobs.map((j) => _buildRecentImportTile(j, theme)),
      ],
    );
  }

  Widget _buildRecentImportTile(Map<String, dynamic> j, ThemeData theme) {
    final status = j['status'] ?? 'unknown';
    final created = j['createdRows'] ?? 0;
    final updated = j['updatedRows'] ?? 0;
    final skipped = j['skippedRows'] ?? 0;
    final errors = j['errorRows'] ?? 0;
    final entityLabel =
        _entityTypes[j['entity_type']] ?? (j['entity_type'] ?? '');

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.insert_drive_file_outlined,
                    size: 18, color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    j['fileName'] ?? 'Import',
                    style: theme.textTheme.bodyMedium
                        ?.copyWith(fontWeight: FontWeight.w600),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                _buildStatusBadge(status, theme),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Text(entityLabel,
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                const Spacer(),
                _countChip(Icons.add_circle_outline, '$created', Colors.green,
                    theme),
                const SizedBox(width: 8),
                _countChip(Icons.update, '$updated', Colors.blue, theme),
                if (skipped > 0) ...[
                  const SizedBox(width: 8),
                  _countChip(
                      Icons.skip_next, '$skipped', Colors.orange, theme),
                ],
                if (errors > 0) ...[
                  const SizedBox(width: 8),
                  _countChip(Icons.error_outline, '$errors', Colors.red, theme),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _countChip(
      IconData icon, String label, Color color, ThemeData theme) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: color),
        const SizedBox(width: 2),
        Text(label,
            style:
                theme.textTheme.labelSmall?.copyWith(color: color)),
      ],
    );
  }

  Widget _buildStatusBadge(String status, ThemeData theme) {
    final isCompleted = status == 'completed';
    final color = isCompleted ? Colors.green : Colors.red;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        status,
        style: theme.textTheme.labelSmall
            ?.copyWith(color: color, fontWeight: FontWeight.w600),
      ),
    );
  }

  // --------------------------------------------------------------------------
  // Step 2 – Mapping
  // --------------------------------------------------------------------------

  Widget _buildMappingStep(ThemeData theme) {
    final crmList = _crmFields[_entityType] ?? [];

    return Column(
      key: const ValueKey('mapping'),
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Text(
            'Map each file column to a CRM field for ${_entityTypes[_entityType]}.',
            style: theme.textTheme.bodyMedium,
          ),
        ),
        Expanded(
          child: ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: _fileColumns.length,
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (context, i) {
              final col = _fileColumns[i];
              final mapped = _columnMapping[col];

              return Card(
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  child: Row(
                    children: [
                      // File column label
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('File Column',
                                style: theme.textTheme.labelSmall?.copyWith(
                                    color:
                                        theme.colorScheme.onSurfaceVariant)),
                            const SizedBox(height: 2),
                            Text(col,
                                style: theme.textTheme.bodyMedium
                                    ?.copyWith(fontWeight: FontWeight.w600)),
                          ],
                        ),
                      ),
                      const Icon(Icons.arrow_forward, size: 18),
                      const SizedBox(width: 8),
                      // CRM field dropdown
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          value: mapped,
                          isExpanded: true,
                          decoration: InputDecoration(
                            isDense: true,
                            contentPadding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 10),
                            border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(8)),
                            labelText: 'CRM Field',
                          ),
                          items: [
                            const DropdownMenuItem<String>(
                              value: null,
                              child: Text('-- Skip --',
                                  style: TextStyle(
                                      fontStyle: FontStyle.italic,
                                      color: Colors.grey)),
                            ),
                            ...crmList.map((f) => DropdownMenuItem(
                                  value: f,
                                  child: Text(f.replaceAll('_', ' ')),
                                )),
                          ],
                          onChanged: (val) {
                            setState(() => _columnMapping[col] = val);
                          },
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        // Bottom bar
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
          child: Row(
            children: [
              OutlinedButton(
                onPressed: () => _goToStep(_ImportStep.upload),
                child: const Text('Back'),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton.icon(
                  onPressed: _startProcessing,
                  icon: const Icon(Icons.play_arrow),
                  label: const Text('Start Import'),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // --------------------------------------------------------------------------
  // Step 3 – Processing
  // --------------------------------------------------------------------------

  Widget _buildProcessingStep(ThemeData theme) {
    final progress =
        _totalRows > 0 ? _processedRows / _totalRows : 0.0;

    return Center(
      key: const ValueKey('processing'),
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 120,
              height: 120,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  SizedBox(
                    width: 120,
                    height: 120,
                    child: CircularProgressIndicator(
                      value: progress,
                      strokeWidth: 8,
                      backgroundColor: theme.colorScheme.surfaceContainerHighest,
                    ),
                  ),
                  Text(
                    '${(progress * 100).toInt()}%',
                    style: theme.textTheme.headlineSmall
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 32),
            Text(
              'Processing $_processedRows / $_totalRows rows',
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              'Importing ${_entityTypes[_entityType]} from $_pickedFileName',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 24),
            LinearProgressIndicator(value: progress),
          ],
        ),
      ),
    );
  }

  // --------------------------------------------------------------------------
  // Step 4 – Done
  // --------------------------------------------------------------------------

  Widget _buildDoneStep(ThemeData theme) {
    final isSuccess = _importStatus == 'completed';

    return ListView(
      key: const ValueKey('done'),
      padding: const EdgeInsets.all(24),
      children: [
        // Status badge
        Center(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
            decoration: BoxDecoration(
              color: (isSuccess ? Colors.green : Colors.red).withOpacity(0.1),
              borderRadius: BorderRadius.circular(24),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  isSuccess ? Icons.check_circle : Icons.cancel,
                  color: isSuccess ? Colors.green : Colors.red,
                ),
                const SizedBox(width: 8),
                Text(
                  isSuccess ? 'Import Completed' : 'Import Failed',
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: isSuccess ? Colors.green : Colors.red,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 32),

        // Result counts
        _buildResultCard(
            Icons.add_circle, 'Created', _createdCount, Colors.green, theme),
        _buildResultCard(
            Icons.update, 'Updated', _updatedCount, Colors.blue, theme),
        _buildResultCard(
            Icons.skip_next, 'Skipped', _skippedCount, Colors.orange, theme),
        _buildResultCard(
            Icons.error_outline, 'Errors', _errorCount, Colors.red, theme),

        // Error details
        if (_errorDetails.isNotEmpty) ...[
          const SizedBox(height: 24),
          Text('Error Details',
              style: theme.textTheme.titleSmall
                  ?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Card(
            color: theme.colorScheme.errorContainer.withOpacity(0.3),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: _errorDetails
                    .map((e) => Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(Icons.warning_amber,
                                  size: 16,
                                  color: theme.colorScheme.error),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(e,
                                    style: theme.textTheme.bodySmall),
                              ),
                            ],
                          ),
                        ))
                    .toList(),
              ),
            ),
          ),
        ],

        const SizedBox(height: 32),

        // Import More button
        Center(
          child: FilledButton.icon(
            onPressed: _resetWizard,
            icon: const Icon(Icons.upload_file),
            label: const Text('Import More'),
          ),
        ),
      ],
    );
  }

  Widget _buildResultCard(
      IconData icon, String label, int count, Color color, ThemeData theme) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: color.withOpacity(0.12),
          child: Icon(icon, color: color, size: 22),
        ),
        title: Text(label),
        trailing: Text(
          '$count',
          style: theme.textTheme.titleLarge
              ?.copyWith(fontWeight: FontWeight.bold, color: color),
        ),
      ),
    );
  }
}

