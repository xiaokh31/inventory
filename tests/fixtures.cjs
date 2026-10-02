// Isolated regression fixtures. Never included in the standalone HTML or dist/.
function records() {
  const base = { name: '测试货物', shipment: 'FBA-TEST-001', owner: '验证货主', destination: 'ONT8', cartons: 12, pallets: 2, status: 'stored', notes: '', updatedAt: '2026-10-02T02:30:00.000Z' };
  return [
    { ...base, id: 'test-batch-1', location: 'A-05', sku: 'TEST-001' },
    { ...base, id: 'test-batch-2', location: 'A-05', sku: 'TEST-002', shipment: 'FBA-TEST-002', destination: 'LAX9' },
    { ...base, id: 'test-batch-3', location: 'B-03', sku: 'TEST-003', shipment: 'FBA-TEST-003', status: 'outbound', destination: '华东中转仓' }
  ];
}
module.exports = { records };
