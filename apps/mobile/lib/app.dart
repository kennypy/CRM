import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'core/auth/auth_provider.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/register_screen.dart';
import 'features/dashboard/dashboard_screen.dart';
import 'features/contacts/contacts_screen.dart';
import 'features/contacts/contact_detail_screen.dart';
import 'features/companies/companies_screen.dart';
import 'features/deals/deals_screen.dart';
import 'features/activities/activities_screen.dart';
import 'features/tasks/tasks_screen.dart';
import 'features/sequences/sequences_screen.dart';
import 'features/quotes/quotes_screen.dart';
import 'features/reports/reports_screen.dart';
import 'features/ai/ai_screen.dart';
import 'features/workflows/workflows_screen.dart';
import 'features/settings/settings_screen.dart';
import 'features/admin/admin_screen.dart';

class NexCRMApp extends ConsumerWidget {
  const NexCRMApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);

    final router = GoRouter(
      initialLocation: '/login',
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
        GoRoute(path: '/companies', builder: (_, __) => const CompaniesScreen()),
        GoRoute(path: '/activities', builder: (_, __) => const ActivitiesScreen()),
        GoRoute(path: '/tasks', builder: (_, __) => const TasksScreen()),
        GoRoute(path: '/sequences', builder: (_, __) => const SequencesScreen()),
        GoRoute(path: '/quotes', builder: (_, __) => const QuotesScreen()),
        GoRoute(path: '/reports', builder: (_, __) => const ReportsScreen()),
        GoRoute(path: '/ai', builder: (_, __) => const AIScreen()),
        GoRoute(path: '/workflows', builder: (_, __) => const WorkflowsScreen()),
        GoRoute(path: '/settings', builder: (_, __) => const SettingsScreen()),
        GoRoute(path: '/admin', builder: (_, __) => const AdminScreen()),
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
          const Divider(),
          _MoreTile(icon: Icons.autorenew, label: 'Sequences', route: '/sequences'),
          _MoreTile(icon: Icons.request_quote, label: 'Quotes', route: '/quotes'),
          _MoreTile(icon: Icons.account_tree, label: 'Workflows', route: '/workflows'),
          const Divider(),
          _MoreTile(icon: Icons.bar_chart, label: 'Reports', route: '/reports'),
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
