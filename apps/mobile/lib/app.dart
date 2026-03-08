import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'core/auth/auth_provider.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/register_screen.dart';
import 'features/dashboard/dashboard_screen.dart';
import 'features/contacts/contacts_screen.dart';
import 'features/contacts/contact_detail_screen.dart';
import 'features/contacts/contact_form_screen.dart';
import 'features/companies/companies_screen.dart';
import 'features/companies/company_detail_screen.dart';
import 'features/companies/company_form_screen.dart';
import 'features/deals/deals_screen.dart';
import 'features/deals/deal_detail_screen.dart';
import 'features/deals/deal_form_screen.dart';
import 'features/activities/activities_screen.dart';
import 'features/tasks/tasks_screen.dart';
import 'features/sequences/sequences_screen.dart';
import 'features/sequences/sequence_form_screen.dart';
import 'features/quotes/quotes_screen.dart';
import 'features/quotes/quote_form_screen.dart';
import 'features/reports/reports_screen.dart';
import 'features/reports/report_form_screen.dart';
import 'features/ai/ai_screen.dart';
import 'features/workflows/workflows_screen.dart';
import 'features/workflows/workflow_form_screen.dart';
import 'features/settings/settings_screen.dart';
import 'features/settings/profile_settings_screen.dart';
import 'features/settings/workspace_settings_screen.dart';
import 'features/settings/integrations_settings_screen.dart';
import 'features/settings/notifications_settings_screen.dart';
import 'features/settings/security_settings_screen.dart';
import 'features/settings/users_settings_screen.dart';
import 'features/settings/billing_settings_screen.dart';
import 'features/settings/quoting_settings_screen.dart';
import 'features/settings/products_settings_screen.dart';
import 'features/settings/communications_settings_screen.dart';
import 'features/settings/custom_fields_settings_screen.dart';
import 'features/settings/custom_objects_settings_screen.dart';
import 'features/settings/permissions_settings_screen.dart';
import 'features/admin/admin_screen.dart';
import 'features/leads/leads_screen.dart';
import 'features/review/review_queue_screen.dart';
import 'features/import/import_screen.dart';
import 'features/marketing/campaigns_screen.dart';

class NexCRMApp extends ConsumerWidget {
  const NexCRMApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);

    final router = GoRouter(
      initialLocation: '/login',
      observers: [SentryNavigatorObserver()],
      redirect: (context, state) {
        final isAuth = authState.status == AuthStatus.authenticated;
        final isAuthRoute = state.matchedLocation == '/login' || state.matchedLocation == '/register';

        if (!isAuth && !isAuthRoute) return '/login';
        if (isAuth && isAuthRoute) return '/';
        return null;
      },
      routes: [
        // Auth routes
        GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
        GoRoute(path: '/register', builder: (_, __) => const RegisterScreen()),

        // Main app shell with bottom navigation
        StatefulShellRoute.indexedStack(
          builder: (context, state, navigationShell) =>
              _AppShell(navigationShell: navigationShell),
          branches: [
            // Dashboard
            StatefulShellBranch(routes: [
              GoRoute(path: '/', builder: (_, __) => const DashboardScreen()),
            ]),

            // Contacts
            StatefulShellBranch(routes: [
              GoRoute(
                path: '/contacts',
                builder: (_, __) => const ContactsScreen(),
                routes: [
                  GoRoute(
                    path: 'new',
                    builder: (_, __) => const ContactFormScreen(),
                  ),
                  GoRoute(
                    path: ':id',
                    builder: (_, state) => ContactDetailScreen(
                        contactId: state.pathParameters['id']!),
                  ),
                ],
              ),
            ]),

            // Pipeline
            StatefulShellBranch(routes: [
              GoRoute(path: '/pipeline', builder: (_, __) => const DealsScreen()),
            ]),

            // More (drawer-like expandable section)
            StatefulShellBranch(routes: [
              GoRoute(path: '/more', builder: (_, __) => const _MoreScreen()),
            ]),
          ],
        ),

        // Full-screen routes accessible from "More"
        GoRoute(
          path: '/companies',
          builder: (_, __) => const CompaniesScreen(),
          routes: [
            GoRoute(path: 'new', builder: (_, __) => const CompanyFormScreen()),
            GoRoute(
              path: ':id',
              builder: (_, state) => CompanyDetailScreen(
                  companyId: state.pathParameters['id']!),
            ),
          ],
        ),
        GoRoute(path: '/activities', builder: (_, __) => const ActivitiesScreen()),
        GoRoute(path: '/tasks', builder: (_, __) => const TasksScreen()),
        GoRoute(
          path: '/sequences',
          builder: (_, __) => const SequencesScreen(),
          routes: [
            GoRoute(path: 'new', builder: (_, __) => const SequenceFormScreen()),
          ],
        ),
        GoRoute(
          path: '/quotes',
          builder: (_, __) => const QuotesScreen(),
          routes: [
            GoRoute(path: 'new', builder: (_, __) => const QuoteFormScreen()),
          ],
        ),
        GoRoute(
          path: '/reports',
          builder: (_, __) => const ReportsScreen(),
          routes: [
            GoRoute(path: 'new', builder: (_, __) => const ReportFormScreen()),
          ],
        ),
        GoRoute(path: '/ai', builder: (_, __) => const AIScreen()),
        GoRoute(
          path: '/workflows',
          builder: (_, __) => const WorkflowsScreen(),
          routes: [
            GoRoute(path: 'new', builder: (_, __) => const WorkflowFormScreen()),
          ],
        ),
        GoRoute(
          path: '/settings',
          builder: (_, __) => const SettingsScreen(),
          routes: [
            GoRoute(path: 'profile', builder: (_, __) => const ProfileSettingsScreen()),
            GoRoute(path: 'security', builder: (_, __) => const SecuritySettingsScreen()),
            GoRoute(path: 'notifications', builder: (_, __) => const NotificationsSettingsScreen()),
            GoRoute(path: 'workspace', builder: (_, __) => const WorkspaceSettingsScreen()),
            GoRoute(path: 'users', builder: (_, __) => const UsersSettingsScreen()),
            GoRoute(path: 'integrations', builder: (_, __) => const IntegrationsSettingsScreen()),
            GoRoute(path: 'quoting', builder: (_, __) => const QuotingSettingsScreen()),
            GoRoute(path: 'products', builder: (_, __) => const ProductsSettingsScreen()),
            GoRoute(path: 'communications', builder: (_, __) => const CommunicationsSettingsScreen()),
            GoRoute(path: 'billing', builder: (_, __) => const BillingSettingsScreen()),
            GoRoute(path: 'custom-fields', builder: (_, __) => const CustomFieldsSettingsScreen()),
            GoRoute(path: 'custom-objects', builder: (_, __) => const CustomObjectsSettingsScreen()),
            GoRoute(path: 'permissions', builder: (_, __) => const PermissionsSettingsScreen()),
          ],
        ),
        GoRoute(path: '/admin', builder: (_, __) => const AdminScreen()),
        GoRoute(path: '/leads', builder: (_, __) => const LeadsScreen()),
        GoRoute(path: '/review', builder: (_, __) => const ReviewQueueScreen()),
        GoRoute(path: '/import', builder: (_, __) => const ImportScreen()),
        GoRoute(path: '/marketing', builder: (_, __) => const CampaignsScreen()),

        // Deal routes (top-level since pipeline is a shell branch)
        GoRoute(path: '/deals/new', builder: (_, __) => const DealFormScreen()),
        GoRoute(
          path: '/deals/:id',
          builder: (_, state) => DealDetailScreen(
              dealId: state.pathParameters['id']!),
        ),
      ],
    );

    return MaterialApp.router(
      title: 'NexCRM',
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: ThemeMode.system,
      routerConfig: router,
      debugShowCheckedModeBanner: false,
    );
  }
}

/// Bottom navigation shell
class _AppShell extends StatelessWidget {
  final StatefulNavigationShell navigationShell;

  const _AppShell({required this.navigationShell});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: navigationShell.currentIndex,
        onDestinationSelected: (index) => navigationShell.goBranch(
          index,
          initialLocation: index == navigationShell.currentIndex,
        ),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.dashboard_outlined),
            selectedIcon: Icon(Icons.dashboard),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.people_outlined),
            selectedIcon: Icon(Icons.people),
            label: 'Contacts',
          ),
          NavigationDestination(
            icon: Icon(Icons.handshake_outlined),
            selectedIcon: Icon(Icons.handshake),
            label: 'Pipeline',
          ),
          NavigationDestination(
            icon: Icon(Icons.menu),
            selectedIcon: Icon(Icons.menu),
            label: 'More',
          ),
        ],
      ),
    );
  }
}

/// "More" screen — acts as a navigation hub for all other features
class _MoreScreen extends ConsumerWidget {
  const _MoreScreen();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final user = ref.watch(authProvider).user;

    return Scaffold(
      appBar: AppBar(title: const Text('More')),
      body: ListView(
        children: [
          _MoreTile(icon: Icons.business, label: 'Companies', route: '/companies'),
          _MoreTile(icon: Icons.timeline, label: 'Activities', route: '/activities'),
          _MoreTile(icon: Icons.task_alt, label: 'Tasks', route: '/tasks'),
          _MoreTile(icon: Icons.trending_up, label: 'Leads', route: '/leads'),
          const Divider(),
          _MoreTile(icon: Icons.autorenew, label: 'Sequences', route: '/sequences'),
          _MoreTile(icon: Icons.request_quote, label: 'Quotes', route: '/quotes'),
          _MoreTile(icon: Icons.account_tree, label: 'Workflows', route: '/workflows'),
          const Divider(),
          _MoreTile(icon: Icons.bar_chart, label: 'Reports', route: '/reports'),
          _MoreTile(icon: Icons.rate_review, label: 'Review Queue', route: '/review'),
          _MoreTile(icon: Icons.upload_file, label: 'Import', route: '/import'),
          _MoreTile(icon: Icons.campaign, label: 'Marketing', route: '/marketing'),
          _MoreTile(icon: Icons.auto_awesome, label: 'AI Assistant', route: '/ai'),
          const Divider(),
          _MoreTile(icon: Icons.settings, label: 'Settings', route: '/settings'),
          if (user != null && user.isAdmin)
            _MoreTile(
              icon: Icons.shield,
              label: 'Admin Panel',
              route: '/admin',
              color: theme.colorScheme.error,
            ),
        ],
      ),
    );
  }
}

class _MoreTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String route;
  final Color? color;

  const _MoreTile({
    required this.icon,
    required this.label,
    required this.route,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: color),
      title: Text(label, style: TextStyle(color: color)),
      trailing: const Icon(Icons.chevron_right, size: 20),
      onTap: () => context.push(route),
    );
  }
}
