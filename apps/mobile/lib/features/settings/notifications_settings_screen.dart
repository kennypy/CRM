import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class NotificationsSettingsScreen extends ConsumerStatefulWidget {
  const NotificationsSettingsScreen({super.key});

  @override
  ConsumerState<NotificationsSettingsScreen> createState() => _NotificationsSettingsScreenState();
}

class _NotificationsSettingsScreenState extends ConsumerState<NotificationsSettingsScreen> {
  bool _dealUpdates = true;
  bool _taskReminders = true;
  bool _contactActivity = false;
  bool _workflowAlerts = true;
  bool _reportReady = false;
  bool _teamMentions = true;
  bool _dirty = false;

  Future<void> _save() async {
    // Persist to backend when notification settings API is available
    setState(() => _dirty = false);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Notification preferences saved')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (_dirty)
            TextButton(
              onPressed: _save,
              child: const Text('Save'),
            ),
        ],
      ),
      body: ListView(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Text('Push Notifications',
                style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
          ),
          SwitchListTile(
            title: const Text('Deal updates'),
            subtitle: const Text('Stage changes, new deals assigned'),
            value: _dealUpdates,
            onChanged: (v) => setState(() { _dealUpdates = v; _dirty = true; }),
          ),
          SwitchListTile(
            title: const Text('Task reminders'),
            subtitle: const Text('Due dates and overdue tasks'),
            value: _taskReminders,
            onChanged: (v) => setState(() { _taskReminders = v; _dirty = true; }),
          ),
          SwitchListTile(
            title: const Text('Contact activity'),
            subtitle: const Text('Email opens, link clicks'),
            value: _contactActivity,
            onChanged: (v) => setState(() { _contactActivity = v; _dirty = true; }),
          ),
          const Divider(),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: Text('System',
                style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
          ),
          SwitchListTile(
            title: const Text('Workflow alerts'),
            subtitle: const Text('Automation triggers and failures'),
            value: _workflowAlerts,
            onChanged: (v) => setState(() { _workflowAlerts = v; _dirty = true; }),
          ),
          SwitchListTile(
            title: const Text('Report ready'),
            subtitle: const Text('Notify when scheduled reports are ready'),
            value: _reportReady,
            onChanged: (v) => setState(() { _reportReady = v; _dirty = true; }),
          ),
          SwitchListTile(
            title: const Text('Team mentions'),
            subtitle: const Text('When someone mentions you'),
            value: _teamMentions,
            onChanged: (v) => setState(() { _teamMentions = v; _dirty = true; }),
          ),
        ],
      ),
    );
  }
}
