class Tenant {
  final String id;
  final String name;
  final String slug;
  final String? domain;
  final String plan;
  final String dataRegion;
  final Map<String, dynamic> settings;
  final String? parentTenantId;
  final String createdAt;

  const Tenant({
    required this.id,
    required this.name,
    required this.slug,
    this.domain,
    required this.plan,
    required this.dataRegion,
    required this.settings,
    this.parentTenantId,
    required this.createdAt,
  });

  bool get aiEnabled => settings['aiEnabled'] == true;
  Map<String, bool> get features =>
      (settings['features'] as Map<String, dynamic>? ?? {})
          .map((k, v) => MapEntry(k, v == true));

  factory Tenant.fromJson(Map<String, dynamic> json) => Tenant(
        id: json['id'] as String,
        name: json['name'] as String,
        slug: json['slug'] as String,
        domain: json['domain'] as String?,
        plan: json['plan'] as String? ?? 'starter',
        dataRegion: json['dataRegion'] as String? ?? 'us',
        settings: json['settings'] as Map<String, dynamic>? ?? {},
        parentTenantId: json['parentTenantId'] as String?,
        createdAt: json['createdAt'] as String? ?? '',
      );
}
