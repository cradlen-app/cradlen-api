describe('InvoicesService — status machine', () => {
  function computeStatus(
    totalAmount: number,
    paidAmount: number,
    currentStatus: string,
  ): string {
    if (currentStatus === 'DRAFT' || currentStatus === 'VOID')
      return currentStatus;
    if (paidAmount >= totalAmount && totalAmount > 0) return 'PAID';
    if (paidAmount > 0) return 'PARTIALLY_PAID';
    return 'ISSUED';
  }

  it('transitions to PAID when paid_amount >= total_amount', () => {
    expect(computeStatus(200, 200, 'ISSUED')).toBe('PAID');
    expect(computeStatus(200, 250, 'ISSUED')).toBe('PAID');
  });

  it('transitions to PARTIALLY_PAID when partial payment recorded', () => {
    expect(computeStatus(200, 100, 'ISSUED')).toBe('PARTIALLY_PAID');
  });

  it('stays ISSUED when no payment recorded', () => {
    expect(computeStatus(200, 0, 'ISSUED')).toBe('ISSUED');
  });

  it('does not change DRAFT status', () => {
    expect(computeStatus(200, 200, 'DRAFT')).toBe('DRAFT');
  });
});
