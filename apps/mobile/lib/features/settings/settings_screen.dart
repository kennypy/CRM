import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/auth/auth_provider.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final user = ref.watch(authProvider).user;

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          // Profile header
          Container(
            padding: const EdgeInsets.all(24),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 32,
                  backgroundColor: theme.colorScheme.primaryContainer,
                  child: Text(
                    user != null ? user.firstName[0].toUpperCase() : '?',
                    style: theme.textTheme.headlineSmall?.copyWith(
                        color: theme.colorScheme.onPrimaryContainer),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(user?.fullName ?? 'Unknown',
                          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                      Text(user?.email ?? '',
                          style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant)),
                      const SizedBox(height: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.primaryContainer,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          (user?.role ?? 'rep').replaceAll('_', ' '),
                          style: TextStyle(fontSize: 11, color: theme.colorScheme.onPrimaryContainer),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const Divider(),

          // Personal
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: Text('Personal',
                style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant)),
          ),
          _SettingsTile(
            icon: Icons.person_outline,
            title: 'My Profile',
            subtitle: 'Name, email, preferences',
            onTap: () => context.push('/settings/profile'),
          ),
          _SettingsTile(
            icon: Icons.shield_outlined,
            title: 'Security',
            subtitle: 'Password, API keys',
            onTap: () => context.push('/settings/security'),
          ),
          _SettingsTile(
            icon: Icons.notifications_outlined,
            title: 'Notifications',
            subtitle: 'Push notification preferences',
            onTap: () => context.push('/settings/notifications'),
          ),

          if (user != null && user.isAdmin) ...[
            const Divider(),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
              child: Text('Workspace',
                  style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant)),
            ),
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: theme.colorScheme.primaryContainer.withOpacity(0.3),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Icon(Icons.info_outline, size: 16, color: theme.colorScheme.primary),
                  const SizedBox(width: 8),
                  Expanded(child: Text(
                    'These settings apply to your entire workspace. Only admins can change them.',
                    style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.primary, fontSize: 11),
                  )),
                ],
              ),
            ),
            _SettingsTile(
              icon: Icons.business,
              title: 'Company',
              subtitle: 'Organisation name, timezone, currency',
              onTap: () => context.push('/settings/workspace'),
            ),
            _SettingsTile(
              icon: Icons.people_outline,
              title: 'Users',
              subtitle: 'Manage team members and roles',
              onTap: () => context.push('/settings/users'),
            ),
            _SettingsTile(
              icon: Icons.integration_instructions,
              title: 'Integrations',
              subtitle: 'Google, Microsoft, Slack, Zoom, Stripe',
              onTap: () => context.push('/settings/integrations'),
            ),
            _SettingsTile(
              icon: Icons.request_quote_outlined,
              title: 'Quoting',
              subtitle: 'Approval rules, send method, permissions',
              onTap: () => context.push('/settings/quoting'),
            ),
            _SettingsTile(
              icon: Icons.inventory_2_outlined,
              title: 'Products',
              subtitle: 'Product catalog for quotes',
              onTap: () => context.push('/settings/products'),
            ),
            _SettingsTile(
              icon: Icons.phone_outlined,
              title: 'Communications',
              subtitle: 'Email, dialler configuration',
              onTap: () => context.push('/settings/communications'),
            ),
            _SettingsTile(
              icon: Icons.credit_card,
              title: 'Billing',
              subtitle: 'Plan, usage, payment',
              onTap: () => context.push('/settings/billing'),
            ),
            _SettingsTile(
              icon: Icons.view_column_outlined,
              title: 'Custom Fields',
              subtitle: 'Add fields to entities',
              onTap: () => context.push('/settings/custom-fields'),
            ),
            _SettingsTile(
              icon: Icons.widgets_outlined,
              title: 'Custom Objects',
              subtitle: 'Create custom entity types',
              onTap: () => context.push('/settings/custom-objects'),
            ),
            _SettingsTile(
              icon: Icons.lock_outline,
              title: 'Permissions',
              subtitle: 'Field access, record rules',
              onTap: () => context.push('/settings/permissions'),
            ),
          ],

          const Divider(),
          _SettingsTile(
            icon: Icons.info_outline,
            title: 'About',
            subtitle: 'Version 1.0.0',
            onTap: () {},
          ),
          _SettingsTile(
            icon: Icons.logout,
            title: 'Sign Out',
            titleColor: theme.colorScheme.error,
            onTap: () async {
              final confirmed = await showDialog<bool>(
                context: context,
                builder: (context) => AlertDialog(
                  title: const Text('Sign out?'),
                  content: const Text('Are you sure you want to sign out?'),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
                    TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Sign Out')),
                  ],
                ),
              );
              if (confirmed == true) {
                ref.read(authProvider.notifier).logout();
              }
            },
          ),
        ],
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;
  final Color? titleColor;
  final Widget? trailing;

  const _SettingsTile({
    required this.icon,
    required this.title,
    this.subtitle,
    this.onTap,
    this.titleColor,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon),
      title: Text(title, style: TextStyle(color: titleColor)),
      subtitle: subtitle != null ? Text(subtitle!) : null,
      trailing: trailing ?? const Icon(Icons.chevron_right, size: 20),
      onTap: onTap,
    );
  }
}
