import { PaymentStatus } from '@prisma/client';
import {
  netRatio,
  lineReturnAmount,
  cashRefundCap,
  effectiveTotal,
  paymentStatusFor,
} from './order-math';

describe('order-math — деньги/возвраты (регрессии P0-1/2/3)', () => {
  describe('netRatio (P0-1: возврат от нетто-цен)', () => {
    it('без скидки → 1', () => expect(netRatio(200, 200)).toBe(1));
    it('скидка 30 на 200 → 0.85', () =>
      expect(netRatio(170, 200)).toBeCloseTo(0.85));
    it('нулевой валовой итог → 1 (без деления на 0)', () =>
      expect(netRatio(0, 0)).toBe(1));
    it('клампится сверху единицей', () => expect(netRatio(250, 200)).toBe(1));
  });

  describe('lineReturnAmount (P0-1)', () => {
    it('возврат 1×100 при ratio 0.85 → 85 нетто (не 100)', () =>
      expect(lineReturnAmount(1, 100, 0.85)).toBe(85));
    it('без скидки возврат = валовой строке', () =>
      expect(lineReturnAmount(2, 100, 1)).toBe(200));
  });

  describe('cashRefundCap (P0-2: без двойной выдачи налички)', () => {
    it('первый возврат — по остатку полученной налички', () =>
      expect(cashRefundCap(40, 60, 0)).toBe(40));
    it('второй возврат капится уже выданным кэшем (получено 60, вернули 40 → доступно 20)', () =>
      expect(cashRefundCap(40, 60, 40)).toBe(20));
    it('безналичная часть не выдаётся наличными (60 кэш + 40 карта, кэшем уже 60 → 0)', () =>
      expect(cashRefundCap(100, 60, 60)).toBe(0));
  });

  describe('effectiveTotal + paymentStatusFor (P0-3: PAID после возврата)', () => {
    it('после возврата 85 из 170 остаток к оплате = 85', () =>
      expect(effectiveTotal(170, 85)).toBe(85));
    it('внесено = эффективному итогу → PAID (не застревает в PARTIAL)', () => {
      const eff = effectiveTotal(170, 85); // 85
      const balanceDue = eff - 85; // 0
      expect(paymentStatusFor(85, balanceDue)).toBe(PaymentStatus.PAID);
    });
    it('частичная оплата → PARTIAL', () =>
      expect(paymentStatusFor(60, 40)).toBe(PaymentStatus.PARTIAL));
    it('ничего не внесено → UNPAID', () =>
      expect(paymentStatusFor(0, 100)).toBe(PaymentStatus.UNPAID));
  });
});
