package com.bizflowjewelry.backend.sales;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

class SaleMathTest {
    @Test
    void consecutiveReturnsReconcileTheCapturedCostExactly() {
        assertEquals(3, SaleMath.restoredCost(10,0,1,3));
        assertEquals(4, SaleMath.restoredCost(10,1,1,3));
        assertEquals(3, SaleMath.restoredCost(10,2,1,3));
        assertEquals(9_007_199_254_740_991L,
                SaleMath.restoredCost(9_007_199_254_740_991L,0,1_000_000,1_000_000));
    }

    @Test
    void returnCreditsSettleReceivablesBeforeCashRefund() {
        assertEquals(0, SaleMath.refund(50,50));
        assertEquals(0, SaleMath.refund(40,50));
        assertEquals(10, SaleMath.refund(60,50));
    }
}
