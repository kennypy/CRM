import 'dart:convert';

class User {
  final String id;
  final String tenantId;
  final String email;
  final String firstName;
  final String lastName;
  final String fullName;
  final String role;
  final String? avatarUrl;
  final String? lastLoginAt;
  final String createdAt;

  const User({
    required this.id,
    required this.tenantId,
    required this.email,
    required this.firstName,
    required this.lastName,
    required this.fullName,
    required this.role,
    this.avatarUrl,
    this.lastLoginAt,
    required this.createdAt,
  });

  bool get isSuperAdmin => role == 'super_admin';
  bool get isAdmin => role == 'admin' || role == 'super_admin';
  bool get isManager => isAdmin || role == 'manager';

  factory User.fromJson(Map<String, dynamic> json) => User(
        id: json['id'] as String,
        tenantId: json['tenantId'] as String? ?? '',
        email: json['email'] as String,
        firstName: json['firstName'] as String? ?? json['first_name'] as String? ?? '',
        lastName: json['lastName'] as String? ?? json['last_name'] as String? ?? '',
        fullName: json['fullName'] as String? ?? '${json['firstName'] ?? json['first_name'] ?? ''} ${json['lastName'] ?? json['last_name'] ?? ''}'.trim(),
        role: json['role'] as String? ?? 'rep',
        avatarUrl: json['avatarUrl'] as String?,
        lastLoginAt: json['lastLoginAt'] as String?,
        createdAt: json['createdAt'] as String? ?? '',
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'tenantId': tenantId,
        'email': email,
        'firstName': firstName,
        'lastName': lastName,
        'fullName': fullName,
        'role': role,
        'avatarUrl': avatarUrl,
        'lastLoginAt': lastLoginAt,
        'createdAt': createdAt,
      };

  String toJsonString() => jsonEncode(toJson());

  factory User.fromJsonString(String source) =>
      User.fromJson(jsonDecode(source) as Map<String, dynamic>);
}
