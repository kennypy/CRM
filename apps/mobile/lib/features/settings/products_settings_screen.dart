import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';

class ProductsSettingsScreen extends ConsumerStatefulWidget {
  const ProductsSettingsScreen({super.key});

  @override
  ConsumerState<ProductsSettingsScreen> createState() => _ProductsSettingsScreenState();
}

class _ProductsSettingsScreenState extends ConsumerState<ProductsSettingsScreen> {
  List<Map<String, dynamic>> _products = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadProducts();
  }

  Future<void> _loadProducts() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.products);
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['products'] ?? []) : []);
      if (mounted) setState(() => _products = List<Map<String, dynamic>>.from(items));
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to load products');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _showProductDialog([Map<String, dynamic>? existing]) {
    final nameCtl = TextEditingController(text: existing?['name'] ?? '');
    final skuCtl = TextEditingController(text: existing?['sku'] ?? '');
    final descCtl = TextEditingController(text: existing?['description'] ?? '');
    final priceCtl = TextEditingController(text: existing?['unitPrice']?.toString() ?? existing?['unit_price']?.toString() ?? '');
    String currency = existing?['currency'] ?? 'USD';
    String billingCycle = existing?['billingCycle'] ?? existing?['billing_cycle'] ?? 'one_time';
    bool active = existing?['active'] ?? true;
    bool submitting = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(child: Text(existing != null ? 'Edit Product' : 'Add Product',
                        style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold))),
                    IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(controller: skuCtl, decoration: const InputDecoration(labelText: 'SKU')),
                const SizedBox(height: 12),
                TextField(controller: nameCtl, decoration: const InputDecoration(labelText: 'Product name')),
                const SizedBox(height: 12),
                TextField(controller: descCtl, decoration: const InputDecoration(labelText: 'Description'), maxLines: 2),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: priceCtl,
                        decoration: const InputDecoration(labelText: 'Unit price'),
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      ),
                    ),
                    const SizedBox(width: 12),
                    SizedBox(
                      width: 100,
                      child: DropdownButtonFormField<String>(
                        value: currency,
                        decoration: const InputDecoration(labelText: 'Currency'),
                        items: ['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map((c) =>
                          DropdownMenuItem(value: c, child: Text(c))).toList(),
                        onChanged: (v) => setSheetState(() => currency = v!),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: billingCycle,
                  decoration: const InputDecoration(labelText: 'Billing cycle'),
                  items: const [
                    DropdownMenuItem(value: 'one_time', child: Text('One-time')),
                    DropdownMenuItem(value: 'monthly', child: Text('Monthly')),
                    DropdownMenuItem(value: 'annual', child: Text('Annual')),
                  ],
                  onChanged: (v) => setSheetState(() => billingCycle = v!),
                ),
                SwitchListTile(
                  title: const Text('Active'),
                  value: active,
                  onChanged: (v) => setSheetState(() => active = v),
                  contentPadding: EdgeInsets.zero,
                ),
                const SizedBox(height: 16),
                SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: submitting ? null : () async {
                      if (nameCtl.text.trim().isEmpty) return;
                      setSheetState(() => submitting = true);
                      try {
                        final data = {
                          'sku': skuCtl.text.trim(),
                          'name': nameCtl.text.trim(),
                          'description': descCtl.text.trim(),
                          'unitPrice': double.tryParse(priceCtl.text) ?? 0,
                          'currency': currency,
                          'billingCycle': billingCycle,
                          'active': active,
                        };
                        if (existing != null) {
                          await ApiClient.instance.dio.patch('${Endpoints.products}/${existing['id']}', data: data);
                        } else {
                          await ApiClient.instance.dio.post(Endpoints.products, data: data);
                        }
                        if (ctx.mounted) {
                          Navigator.pop(ctx);
                          _loadProducts();
                        }
                      } catch (_) {
                        if (ctx.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Failed to save product')),
                          );
                        }
                      } finally {
                        if (ctx.mounted) setSheetState(() => submitting = false);
                      }
                    },
                    child: submitting
                        ? const SizedBox(height: 20, width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : Text(existing != null ? 'Update' : 'Create'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Products')),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showProductDialog(),
        child: const Icon(Icons.add),
      ),
      body: _error != null
          ? Center(child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(_error!),
                const SizedBox(height: 8),
                ElevatedButton(onPressed: _loadProducts, child: const Text('Retry')),
              ],
            ))
          : _loading
              ? const Center(child: CircularProgressIndicator())
              : _products.isEmpty
                  ? Center(child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.inventory_2_outlined, size: 48, color: theme.colorScheme.onSurfaceVariant),
                        const SizedBox(height: 12),
                        Text('No products yet', style: theme.textTheme.bodyMedium),
                        const SizedBox(height: 8),
                        ElevatedButton(onPressed: () => _showProductDialog(), child: const Text('Add Product')),
                      ],
                    ))
                  : RefreshIndicator(
                      onRefresh: _loadProducts,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(12),
                        itemCount: _products.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (context, index) {
                          final p = _products[index];
                          final price = p['unitPrice'] ?? p['unit_price'] ?? 0;
                          final cycle = p['billingCycle'] ?? p['billing_cycle'] ?? 'one_time';
                          final cycleLabel = cycle == 'monthly' ? '/mo' : cycle == 'annual' ? '/yr' : '';
                          final isActive = p['active'] != false;

                          return Card(
                            child: ListTile(
                              leading: Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: (isActive ? Colors.blue : Colors.grey).withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Icon(Icons.inventory_2, size: 20,
                                    color: isActive ? Colors.blue : Colors.grey),
                              ),
                              title: Text(p['name'] ?? '', style: const TextStyle(fontWeight: FontWeight.w500)),
                              subtitle: Text(p['sku'] ?? ''),
                              trailing: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  Text('\$${price is num ? price.toStringAsFixed(2) : price}$cycleLabel',
                                      style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
                                  if (!isActive)
                                    Text('Inactive', style: TextStyle(fontSize: 10, color: Colors.grey[500])),
                                ],
                              ),
                              onTap: () => _showProductDialog(p),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
