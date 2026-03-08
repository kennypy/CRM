import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/error_view.dart';

// ── Data Models ──────────────────────────────────────────────────────────────

class MarketplaceApp {
  final String id;
  final String slug;
  final String name;
  final String description;
  final String? shortDescription;
  final String? iconUrl;
  final String publisher;
  final String category;
  final String authType;
  final List<String> scopes;
  final String version;
  final bool isInstalled;
  final String? installId;
  final String? installStatus;

  const MarketplaceApp({
    required this.id,
    required this.slug,
    required this.name,
    required this.description,
    this.shortDescription,
    this.iconUrl,
    required this.publisher,
    required this.category,
    required this.authType,
    this.scopes = const [],
    required this.version,
    this.isInstalled = false,
    this.installId,
    this.installStatus,
  });

  factory MarketplaceApp.fromJson(Map<String, dynamic> json) {
    return MarketplaceApp(
      id: json['id']?.toString() ?? '',
      slug: json['slug'] ?? '',
      name: json['name'] ?? json['appName'] ?? '',
      description: json['description'] ?? '',
      shortDescription: json['shortDescription'] ?? json['short_description'],
      iconUrl: json['iconUrl'] ?? json['icon_url'],
      publisher: json['publisher'] ?? '',
      category: json['category'] ?? json['appCategory'] ?? 'custom',
      authType: json['authType'] ?? json['auth_type'] ?? 'api_key',
      scopes: List<String>.from(json['scopes'] ?? []),
      version: json['version'] ?? '1.0.0',
      isInstalled: json['isInstalled'] == true || json['is_installed'] == true,
      installId: json['installId'] ?? json['install_id'],
      installStatus: json['installStatus'] ?? json['install_status'],
    );
  }

  MarketplaceApp copyWith({bool? isInstalled, String? installId}) {
    return MarketplaceApp(
      id: id,
      slug: slug,
      name: name,
      description: description,
      shortDescription: shortDescription,
      iconUrl: iconUrl,
      publisher: publisher,
      category: category,
      authType: authType,
      scopes: scopes,
      version: version,
      isInstalled: isInstalled ?? this.isInstalled,
      installId: installId ?? this.installId,
      installStatus: installStatus,
    );
  }
}

// ── Constants ────────────────────────────────────────────────────────────────

const _kCategories = [
  'All',
  'Email',
  'CRM',
  'Data',
  'Analytics',
  'Communication',
  'Productivity',
];

const _kCategoryApiValues = <String, String>{
  'All': 'all',
  'Email': 'marketing',
  'CRM': 'custom',
  'Data': 'data_enrichment',
  'Analytics': 'analytics',
  'Communication': 'communication',
  'Productivity': 'productivity',
};

const _kCategoryIcons = <String, IconData>{
  'communication': Icons.message_outlined,
  'productivity': Icons.swap_vert,
  'analytics': Icons.bar_chart,
  'data_enrichment': Icons.storage,
  'marketing': Icons.email_outlined,
  'support': Icons.shield_outlined,
  'finance': Icons.bolt,
  'custom': Icons.store_outlined,
};

const _kCategoryColors = <String, Color>{
  'communication': Colors.blue,
  'productivity': Colors.purple,
  'analytics': Colors.indigo,
  'data_enrichment': Colors.green,
  'marketing': Colors.pink,
  'support': Colors.orange,
  'finance': Colors.amber,
  'custom': Colors.grey,
};

const _kAppIcons = <String, IconData>{
  'zoom': Icons.videocam_outlined,
  'slack': Icons.message_outlined,
  'clearbit': Icons.storage,
  'hubspot-import': Icons.swap_vert,
  'mailchimp': Icons.email_outlined,
};

const _kDemoApps = <Map<String, dynamic>>[
  {
    'id': '1',
    'slug': 'zoom',
    'name': 'Zoom',
    'description':
        'Automatically ingest and transcribe Zoom meeting recordings. Extract action items, sentiment, and buying signals from sales calls.',
    'shortDescription': 'Meeting transcription & analysis',
    'publisher': 'NexCRM',
    'category': 'communication',
    'authType': 'oauth2',
    'scopes': <String>[],
    'version': '1.0.0',
    'isInstalled': false,
  },
  {
    'id': '2',
    'slug': 'slack',
    'name': 'Slack',
    'description':
        'Monitor Slack channels for deal mentions, customer requests, and team collaboration signals. Auto-capture activities from conversations.',
    'shortDescription': 'Channel monitoring & signal capture',
    'publisher': 'NexCRM',
    'category': 'communication',
    'authType': 'oauth2',
    'scopes': <String>[],
    'version': '1.0.0',
    'isInstalled': false,
  },
  {
    'id': '3',
    'slug': 'clearbit',
    'name': 'Clearbit Enrichment',
    'description':
        'Enrich contacts and companies with firmographic, technographic, and demographic data. Auto-fill missing fields on new records.',
    'shortDescription': 'Contact & company data enrichment',
    'publisher': 'Clearbit',
    'category': 'data_enrichment',
    'authType': 'api_key',
    'scopes': <String>[],
    'version': '1.0.0',
    'isInstalled': false,
  },
  {
    'id': '4',
    'slug': 'hubspot-import',
    'name': 'HubSpot Import',
    'description':
        'One-click migration from HubSpot CRM. Import contacts, companies, deals, and activities with field mapping and deduplication.',
    'shortDescription': 'Migrate from HubSpot CRM',
    'publisher': 'NexCRM',
    'category': 'productivity',
    'authType': 'api_key',
    'scopes': <String>[],
    'version': '1.0.0',
    'isInstalled': false,
  },
  {
    'id': '5',
    'slug': 'mailchimp',
    'name': 'Mailchimp',
    'description':
        'Sync contacts and segments with Mailchimp for email marketing campaigns. Track email engagement as CRM activities.',
    'shortDescription': 'Email marketing sync & tracking',
    'publisher': 'Mailchimp',
    'category': 'marketing',
    'authType': 'api_key',
    'scopes': <String>[],
    'version': '1.0.0',
    'isInstalled': false,
  },
];

// ── Screen ───────────────────────────────────────────────────────────────────

class MarketplaceScreen extends ConsumerStatefulWidget {
  const MarketplaceScreen({super.key});

  @override
  ConsumerState<MarketplaceScreen> createState() => _MarketplaceScreenState();
}

class _MarketplaceScreenState extends ConsumerState<MarketplaceScreen> {
  List<MarketplaceApp> _apps = [];
  bool _loading = true;
  String? _error;
  String _searchQuery = '';
  String _selectedCategory = 'All';
  bool _installing = false;

  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadApps();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadApps() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final category = _kCategoryApiValues[_selectedCategory] ?? 'all';
      final params = <String, String>{};
      if (category != 'all') params['category'] = category;

      final res = await ApiClient.instance.dio.get(
        '${Endpoints.apiUrl}/api/v1/marketplace',
        queryParameters: params,
      );
      final data = res.data['data'];
      final items = data is List
          ? data
          : (data is Map
              ? (data['items'] ?? data['apps'] ?? [])
              : []);
      if (mounted) {
        final parsed = (items as List)
            .map((e) => MarketplaceApp.fromJson(Map<String, dynamic>.from(e)))
            .toList();
        setState(() => _apps = parsed.isNotEmpty ? parsed : _demoParsed());
      }
    } catch (_) {
      if (mounted) setState(() => _apps = _demoParsed());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<MarketplaceApp> _demoParsed() =>
      _kDemoApps.map((e) => MarketplaceApp.fromJson(e)).toList();

  List<MarketplaceApp> get _filteredApps {
    var result = _apps;
    if (_searchQuery.isNotEmpty) {
      final q = _searchQuery.toLowerCase();
      result = result.where((a) {
        return a.name.toLowerCase().contains(q) ||
            (a.shortDescription ?? a.description).toLowerCase().contains(q);
      }).toList();
    }
    return result;
  }

  List<MarketplaceApp> get _installedApps =>
      _filteredApps.where((a) => a.isInstalled).toList();

  List<MarketplaceApp> get _availableApps =>
      _filteredApps.where((a) => !a.isInstalled).toList();

  Future<void> _installApp(MarketplaceApp app) async {
    setState(() => _installing = true);
    try {
      if (app.authType == 'oauth2') {
        // Trigger OAuth flow — in production this would launch a browser/webview
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Launching OAuth flow for ${app.name}...'),
          ),
        );
      }
      await ApiClient.instance.dio.post(
        '${Endpoints.apiUrl}/api/v1/marketplace/install',
        data: {'appId': app.id},
      );
      if (mounted) {
        setState(() {
          _apps = _apps
              .map((a) => a.id == app.id ? a.copyWith(isInstalled: true) : a)
              .toList();
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${app.name} installed successfully')),
        );
      }
    } catch (_) {
      if (mounted) {
        // Optimistic local update for demo
        setState(() {
          _apps = _apps
              .map((a) => a.id == app.id ? a.copyWith(isInstalled: true) : a)
              .toList();
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${app.name} installed (offline mode)')),
        );
      }
    } finally {
      if (mounted) setState(() => _installing = false);
    }
  }

  Future<void> _uninstallApp(MarketplaceApp app) async {
    try {
      if (app.installId != null) {
        await ApiClient.instance.dio.delete(
          '${Endpoints.apiUrl}/api/v1/marketplace/installs/${app.installId}',
        );
      }
    } catch (_) {
      // continue with local removal
    }
    if (mounted) {
      setState(() {
        _apps = _apps
            .map((a) =>
                a.id == app.id ? a.copyWith(isInstalled: false) : a)
            .toList();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${app.name} uninstalled')),
      );
    }
  }

  void _showAppDetail(MarketplaceApp app) {
    final theme = Theme.of(context);
    final catColor = _kCategoryColors[app.category] ?? Colors.grey;
    final appIcon = _kAppIcons[app.slug] ?? Icons.store_outlined;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(
            20,
            20,
            20,
            MediaQuery.of(ctx).viewInsets.bottom + 20,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Handle bar
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.onSurfaceVariant.withOpacity(0.3),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              // Header
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primary.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(appIcon, size: 24, color: theme.colorScheme.primary),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(app.name,
                            style: theme.textTheme.titleMedium
                                ?.copyWith(fontWeight: FontWeight.bold)),
                        Text(
                          'by ${app.publisher} \u00b7 v${app.version}',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              // Tags
              Wrap(
                spacing: 8,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: catColor.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      app.category.replaceAll('_', ' '),
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: catColor,
                      ),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      app.authType.replaceAll('_', ' '),
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              // Description
              Text(
                app.description,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                  height: 1.5,
                ),
              ),
              // Permissions / scopes
              if (app.scopes.isNotEmpty) ...[
                const SizedBox(height: 16),
                Text('Permissions Required',
                    style: theme.textTheme.titleSmall
                        ?.copyWith(fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                ...app.scopes.map((scope) => Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Row(
                        children: [
                          Icon(Icons.check_circle_outline,
                              size: 16, color: theme.colorScheme.primary),
                          const SizedBox(width: 8),
                          Text(scope, style: theme.textTheme.bodySmall),
                        ],
                      ),
                    )),
              ],
              // Configuration note
              if (app.authType == 'oauth2') ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.blue.withOpacity(0.06),
                    border: Border.all(color: Colors.blue.withOpacity(0.2)),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.info_outline, size: 16, color: Colors.blue),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'This app requires OAuth authentication. You will be redirected to authorize access.',
                          style: TextStyle(
                              fontSize: 12, color: Colors.blue.shade700),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              // Installed status
              if (app.isInstalled) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.green.withOpacity(0.06),
                    border: Border.all(color: Colors.green.withOpacity(0.2)),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.check_circle, size: 16, color: Colors.green),
                      const SizedBox(width: 8),
                      Text(
                        'Installed & Active',
                        style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: Colors.green.shade700),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 20),
              // Actions
              Row(
                children: [
                  Expanded(
                    child: app.isInstalled
                        ? OutlinedButton(
                            onPressed: () {
                              Navigator.pop(ctx);
                              _uninstallApp(app);
                            },
                            style: OutlinedButton.styleFrom(
                              foregroundColor: Colors.red,
                              side: const BorderSide(color: Colors.red),
                              padding: const EdgeInsets.symmetric(vertical: 12),
                            ),
                            child: const Text('Uninstall'),
                          )
                        : FilledButton(
                            onPressed: _installing
                                ? null
                                : () {
                                    Navigator.pop(ctx);
                                    _installApp(app);
                                  },
                            style: FilledButton.styleFrom(
                              padding: const EdgeInsets.symmetric(vertical: 12),
                            ),
                            child: _installing
                                ? const SizedBox(
                                    height: 20,
                                    width: 20,
                                    child: CircularProgressIndicator(
                                        strokeWidth: 2, color: Colors.white),
                                  )
                                : const Text('Install'),
                          ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(ctx),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                      ),
                      child: const Text('Close'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final installed = _installedApps;
    final available = _availableApps;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Marketplace'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadApps,
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: SizedBox(
            height: 42,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              children: _kCategories
                  .map(
                    (cat) => Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(cat),
                        selected: _selectedCategory == cat,
                        onSelected: (_) {
                          setState(() => _selectedCategory = cat);
                          _loadApps();
                        },
                      ),
                    ),
                  )
                  .toList(),
            ),
          ),
        ),
      ),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _loadApps)
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : RefreshIndicator(
                  onRefresh: _loadApps,
                  child: CustomScrollView(
                    slivers: [
                      // Search bar
                      SliverToBoxAdapter(
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
                          child: TextField(
                            controller: _searchController,
                            onChanged: (v) => setState(() => _searchQuery = v),
                            decoration: InputDecoration(
                              hintText: 'Search apps...',
                              prefixIcon: const Icon(Icons.search, size: 20),
                              suffixIcon: _searchQuery.isNotEmpty
                                  ? IconButton(
                                      icon: const Icon(Icons.clear, size: 20),
                                      onPressed: () {
                                        _searchController.clear();
                                        setState(() => _searchQuery = '');
                                      },
                                    )
                                  : null,
                              filled: true,
                              fillColor:
                                  theme.colorScheme.surfaceContainerHighest,
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: BorderSide.none,
                              ),
                              contentPadding:
                                  const EdgeInsets.symmetric(vertical: 0),
                            ),
                          ),
                        ),
                      ),

                      // Installed section
                      if (installed.isNotEmpty) ...[
                        SliverToBoxAdapter(
                          child: Padding(
                            padding:
                                const EdgeInsets.fromLTRB(16, 16, 16, 8),
                            child: Text(
                              'Installed',
                              style: theme.textTheme.titleSmall?.copyWith(
                                fontWeight: FontWeight.w600,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                        ),
                        SliverPadding(
                          padding:
                              const EdgeInsets.symmetric(horizontal: 12),
                          sliver: SliverGrid(
                            gridDelegate:
                                const SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: 2,
                              mainAxisSpacing: 8,
                              crossAxisSpacing: 8,
                              childAspectRatio: 0.85,
                            ),
                            delegate: SliverChildBuilderDelegate(
                              (context, index) =>
                                  _AppCard(app: installed[index], onTap: _showAppDetail),
                              childCount: installed.length,
                            ),
                          ),
                        ),
                      ],

                      // Available section
                      SliverToBoxAdapter(
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                          child: Text(
                            'Available',
                            style: theme.textTheme.titleSmall?.copyWith(
                              fontWeight: FontWeight.w600,
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                      ),
                      if (available.isEmpty && installed.isEmpty)
                        const SliverFillRemaining(
                          child: EmptyState(
                            icon: Icons.store_outlined,
                            title: 'No apps found',
                            subtitle: 'Try adjusting your search or filters',
                          ),
                        )
                      else
                        SliverPadding(
                          padding: const EdgeInsets.fromLTRB(12, 0, 12, 16),
                          sliver: SliverGrid(
                            gridDelegate:
                                const SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: 2,
                              mainAxisSpacing: 8,
                              crossAxisSpacing: 8,
                              childAspectRatio: 0.85,
                            ),
                            delegate: SliverChildBuilderDelegate(
                              (context, index) =>
                                  _AppCard(app: available[index], onTap: _showAppDetail),
                              childCount: available.length,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
    );
  }
}

// ── App Card Widget ──────────────────────────────────────────────────────────

class _AppCard extends StatelessWidget {
  final MarketplaceApp app;
  final void Function(MarketplaceApp) onTap;

  const _AppCard({required this.app, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final catColor = _kCategoryColors[app.category] ?? Colors.grey;
    final appIcon = _kAppIcons[app.slug] ?? Icons.store_outlined;

    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => onTap(app),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primary.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(appIcon, size: 20, color: theme.colorScheme.primary),
                  ),
                  const Spacer(),
                  if (app.isInstalled)
                    const Icon(Icons.check_circle, size: 18, color: Colors.green),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                app.name,
                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              if (app.publisher.isNotEmpty)
                Text(
                  app.publisher,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                    fontSize: 11,
                  ),
                ),
              const SizedBox(height: 6),
              Expanded(
                child: Text(
                  app.shortDescription ?? app.description,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(height: 6),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: catColor.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      app.category.replaceAll('_', ' '),
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                        color: catColor,
                      ),
                    ),
                  ),
                  if (!app.isInstalled)
                    Text(
                      'Install \u2192',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: theme.colorScheme.primary,
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
