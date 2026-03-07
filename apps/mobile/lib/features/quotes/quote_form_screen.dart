import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';

class QuoteFormScreen extends ConsumerStatefulWidget {
  const QuoteFormScreen({super.key});

  @override
  ConsumerState<QuoteFormScreen> createState() => _QuoteFormScreenState();
}

class _QuoteFormScreenState extends ConsumerState<QuoteFormScreen> {
  final _titleCtl = TextEditingController();
  final _notesCtl = TextEditingController();
  final _termsCtl = TextEditingController(text: 'Payment is due within 30 days of invoice date.');
  DateTime? _validUntil;
  String _currency = 'USD';
  double _taxRate = 0;
  String _discountType = 'none';
  double _discountValue = 0;
  bool _saving = false;

  // Line items
  final List<Map<String, dynamic>> _items = [
    {'name': '', 'description': '', 'qty': 1.0, 'unitPrice': 0.0, 'discountPct': 0.0},
  ];

  // Products for picker
  List<Map<String, dynamic>> _products = [];
  bool _loadingProducts = false;

  // Contact search
  Map<String, dynamic>? _selectedContact;

  @override
  void initState() {
    super.initState();
    _validUntil = DateTime.now().add(const Duration(days: 30));
    _loadProducts();
  }

  @override
  void dispose() {
    _titleCtl.dispose();
    _notesCtl.dispose();
    _termsCtl.dispose();
    super.dispose();
  }

  Future<void> _loadProducts() async {
    setState(() => _loadingProducts = true);
    try {
      final res = await ApiClient.instance.dio.get(Endpoints.products);
      final data = res.data['data'];
      final items = data is List ? data : (data is Map ? (data['items'] ?? data['products'] ?? []) : []);
      if (mounted) setState(() => _products = List<Map<String, dynamic>>.from(items));
    } catch (_) {}
    finally { if (mounted) setState(() => _loadingProducts = false); }
  }

  double get _subtotal => _items.fold(0, (sum, item) {
    final qty = (item['qty'] as num).toDouble();
    final price = (item['unitPrice'] as num).toDouble();
    final disc = (item['discountPct'] as num).toDouble();
    return sum + (qty * price * (1 - disc / 100));
  });

  double get _discountAmount {
    if (_discountType == 'none') return 0;
    if (_discountType == 'percent') return _subtotal * _discountValue / 100;
    return _discountValue;
  }

  double get _taxAmount => (_subtotal - _discountAmount) * _taxRate / 100;
  double get _total => _subtotal - _discountAmount + _taxAmount;

  void _showProductPicker(int itemIndex) {
    showModalBottomSheet(
      context: context,
      builder: (ctx) => Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text('Select Product', style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
          ),
          const Divider(height: 1),
          Expanded(
            child: _products.isEmpty
                ? const Center(child: Text('No products available'))
                : ListView.separated(
                    itemCount: _products.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (ctx2, i) {
                      final p = _products[i];
                      return ListTile(
                        title: Text(p['name'] ?? ''),
                        subtitle: Text(p['sku'] ?? ''),
                        trailing: Text('\$${p['unitPrice'] ?? p['unit_price'] ?? 0}',
                            style: const TextStyle(fontWeight: FontWeight.w600)),
                        onTap: () {
                          setState(() {
                            _items[itemIndex]['name'] = p['name'] ?? '';
                            _items[itemIndex]['unitPrice'] = (p['unitPrice'] ?? p['unit_price'] ?? 0).toDouble();
                            _items[itemIndex]['productId'] = p['id'];
                          });
                          Navigator.pop(ctx2);
                        },
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }

  void _searchContact() {
    final searchCtl = TextEditingController();
    List<Map<String, dynamic>> results = [];
    bool searching = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(ctx).viewInsets.bottom + 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: searchCtl,
                decoration: const InputDecoration(labelText: 'Search contacts', prefixIcon: Icon(Icons.search)),
                onSubmitted: (v) async {
                  if (v.trim().isEmpty) return;
                  setSheetState(() => searching = true);
                  try {
                    final res = await ApiClient.instance.dio.get(Endpoints.contacts,
                        queryParameters: {'search': v.trim(), 'limit': '8'});
                    final data = res.data['data'];
                    final items = data is List ? data : (data is Map ? (data['items'] ?? data['contacts'] ?? []) : []);
                    setSheetState(() => results = List<Map<String, dynamic>>.from(items));
                  } catch (_) {}
                  finally { setSheetState(() => searching = false); }
                },
              ),
              const SizedBox(height: 8),
              if (searching) const Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()),
              ...results.map((c) {
                final name = '${c['firstName'] ?? ''} ${c['lastName'] ?? ''}'.trim();
                return ListTile(
                  title: Text(name),
                  subtitle: Text(c['email'] ?? ''),
                  onTap: () {
                    setState(() => _selectedContact = c);
                    Navigator.pop(ctx);
                  },
                );
              }),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _handleSubmit() async {
    if (_titleCtl.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Title is required')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      final data = <String, dynamic>{
        'title': _titleCtl.text.trim(),
        'status': 'draft',
        'currency': _currency,
        'taxRate': _taxRate,
        'discountType': _discountType,
        'discountValue': _discountValue,
        'notes': _notesCtl.text.trim(),
        'terms': _termsCtl.text.trim(),
        'items': _items.map((item) => {
          'productName': item['name'],
          'description': item['description'],
          'quantity': item['qty'],
          'unitPrice': item['unitPrice'],
          'discountPct': item['discountPct'],
          if (item['productId'] != null) 'productId': item['productId'],
        }).toList(),
      };
      if (_validUntil != null) data['validUntil'] = _validUntil!.toIso8601String().split('T')[0];
      if (_selectedContact != null) data['contactId'] = _selectedContact!['id'];

      await ApiClient.instance.dio.post(Endpoints.quotes, data: data);
      if (mounted) context.pop(true);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to create quote')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('New Quote'),
        actions: [
          TextButton(
            onPressed: _saving ? null : _handleSubmit,
            child: _saving
                ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Create'),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Title
          TextField(controller: _titleCtl,
              decoration: const InputDecoration(labelText: 'Quote title *', border: OutlineInputBorder())),
          const SizedBox(height: 16),

          // Contact
          Card(
            child: ListTile(
              leading: const Icon(Icons.person_outline),
              title: Text(_selectedContact != null
                  ? '${_selectedContact!['firstName'] ?? ''} ${_selectedContact!['lastName'] ?? ''}'.trim()
                  : 'Link contact'),
              subtitle: _selectedContact != null ? Text(_selectedContact!['email'] ?? '') : null,
              trailing: _selectedContact != null
                  ? IconButton(icon: const Icon(Icons.close, size: 18),
                      onPressed: () => setState(() => _selectedContact = null))
                  : const Icon(Icons.search, size: 20),
              onTap: _searchContact,
            ),
          ),
          const SizedBox(height: 12),

          // Currency and validity
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  value: _currency,
                  decoration: const InputDecoration(labelText: 'Currency'),
                  items: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'CHF', 'JPY'].map((c) =>
                    DropdownMenuItem(value: c, child: Text(c))).toList(),
                  onChanged: (v) => setState(() => _currency = v!),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: InkWell(
                  onTap: () async {
                    final picked = await showDatePicker(
                      context: context,
                      initialDate: _validUntil ?? DateTime.now().add(const Duration(days: 30)),
                      firstDate: DateTime.now(),
                      lastDate: DateTime.now().add(const Duration(days: 365)),
                    );
                    if (picked != null) setState(() => _validUntil = picked);
                  },
                  child: InputDecorator(
                    decoration: const InputDecoration(labelText: 'Valid until'),
                    child: Text(_validUntil != null
                        ? _validUntil!.toIso8601String().split('T')[0]
                        : 'Select date'),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Tax and discount
          Row(
            children: [
              SizedBox(
                width: 100,
                child: TextField(
                  decoration: const InputDecoration(labelText: 'Tax %', suffixText: '%'),
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  onChanged: (v) => setState(() => _taxRate = double.tryParse(v) ?? 0),
                ),
              ),
              const SizedBox(width: 12),
              SizedBox(
                width: 100,
                child: DropdownButtonFormField<String>(
                  value: _discountType,
                  decoration: const InputDecoration(labelText: 'Discount'),
                  items: const [
                    DropdownMenuItem(value: 'none', child: Text('None')),
                    DropdownMenuItem(value: 'percent', child: Text('%')),
                    DropdownMenuItem(value: 'fixed', child: Text('Fixed')),
                  ],
                  onChanged: (v) => setState(() => _discountType = v!),
                ),
              ),
              if (_discountType != 'none') ...[
                const SizedBox(width: 12),
                Expanded(
                  child: TextField(
                    decoration: InputDecoration(
                      labelText: _discountType == 'percent' ? 'Discount %' : 'Discount amount',
                    ),
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    onChanged: (v) => setState(() => _discountValue = double.tryParse(v) ?? 0),
                  ),
                ),
              ],
            ],
          ),

          const SizedBox(height: 24),

          // Line Items
          Text('Line Items', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          ...(_items.asMap().entries.map((entry) {
            final i = entry.key;
            final item = entry.value;
            return Card(
              margin: const EdgeInsets.only(bottom: 12),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            decoration: const InputDecoration(labelText: 'Product / Description', isDense: true),
                            controller: TextEditingController(text: item['name']),
                            onChanged: (v) => item['name'] = v,
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.inventory_2_outlined, size: 20),
                          onPressed: () => _showProductPicker(i),
                          tooltip: 'Pick from catalog',
                        ),
                        if (_items.length > 1)
                          IconButton(
                            icon: const Icon(Icons.delete_outline, size: 20, color: Colors.red),
                            onPressed: () => setState(() => _items.removeAt(i)),
                          ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        SizedBox(width: 60, child: TextField(
                          decoration: const InputDecoration(labelText: 'Qty', isDense: true),
                          keyboardType: TextInputType.number,
                          controller: TextEditingController(text: '${item['qty']}'),
                          onChanged: (v) => setState(() => item['qty'] = double.tryParse(v) ?? 1),
                        )),
                        const SizedBox(width: 8),
                        Expanded(child: TextField(
                          decoration: const InputDecoration(labelText: 'Unit Price', isDense: true),
                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                          controller: TextEditingController(text: '${item['unitPrice']}'),
                          onChanged: (v) => setState(() => item['unitPrice'] = double.tryParse(v) ?? 0),
                        )),
                        const SizedBox(width: 8),
                        SizedBox(width: 60, child: TextField(
                          decoration: const InputDecoration(labelText: 'Disc %', isDense: true),
                          keyboardType: TextInputType.number,
                          controller: TextEditingController(text: '${item['discountPct']}'),
                          onChanged: (v) => setState(() => item['discountPct'] = double.tryParse(v) ?? 0),
                        )),
                        const SizedBox(width: 8),
                        SizedBox(
                          width: 70,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text('Total', style: theme.textTheme.labelSmall),
                              Text('\$${((item['qty'] as num).toDouble() * (item['unitPrice'] as num).toDouble() * (1 - (item['discountPct'] as num).toDouble() / 100)).toStringAsFixed(2)}',
                                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          })),
          OutlinedButton.icon(
            onPressed: () => setState(() =>
              _items.add({'name': '', 'description': '', 'qty': 1.0, 'unitPrice': 0.0, 'discountPct': 0.0})),
            icon: const Icon(Icons.add, size: 18),
            label: const Text('Add line'),
          ),

          const SizedBox(height: 16),

          // Totals
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  _TotalRow(label: 'Subtotal', value: '\$${_subtotal.toStringAsFixed(2)}'),
                  if (_discountAmount > 0)
                    _TotalRow(label: 'Discount', value: '-\$${_discountAmount.toStringAsFixed(2)}', color: Colors.green),
                  if (_taxRate > 0)
                    _TotalRow(label: 'Tax (${_taxRate.toStringAsFixed(1)}%)', value: '\$${_taxAmount.toStringAsFixed(2)}'),
                  const Divider(),
                  _TotalRow(label: 'Total', value: '\$${_total.toStringAsFixed(2)}', bold: true),
                ],
              ),
            ),
          ),

          const SizedBox(height: 16),

          // Notes and terms
          TextField(controller: _notesCtl, maxLines: 3,
              decoration: const InputDecoration(labelText: 'Notes', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          TextField(controller: _termsCtl, maxLines: 4,
              decoration: const InputDecoration(labelText: 'Terms & Conditions', border: OutlineInputBorder())),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class _TotalRow extends StatelessWidget {
  final String label;
  final String value;
  final Color? color;
  final bool bold;

  const _TotalRow({required this.label, required this.value, this.color, this.bold = false});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(
            color: color ?? Theme.of(context).colorScheme.onSurfaceVariant,
            fontWeight: bold ? FontWeight.bold : FontWeight.normal,
            fontSize: bold ? 16 : 14,
          )),
          Text(value, style: TextStyle(
            color: color,
            fontWeight: bold ? FontWeight.bold : FontWeight.w600,
            fontSize: bold ? 18 : 14,
          )),
        ],
      ),
    );
  }
}
