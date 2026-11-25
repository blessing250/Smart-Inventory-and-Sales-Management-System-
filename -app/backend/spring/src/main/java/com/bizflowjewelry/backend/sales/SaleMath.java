package com.bizflowjewelry.backend.sales;

import java.math.BigInteger;

final class SaleMath {
    private SaleMath() {}

    static long refund(long credit, long outstanding) {
        return Math.max(0, credit - outstanding);
    }

    static long restoredCost(long cost, long previousReturns, long returned, long sold) {
        return share(cost, previousReturns + returned, sold) - share(cost, previousReturns, sold);
    }

    private static long share(long amount, long quantity, long total) {
        var denominator = BigInteger.valueOf(total);
        return BigInteger.valueOf(amount).multiply(BigInteger.valueOf(quantity))
                .add(denominator.divide(BigInteger.TWO)).divide(denominator).longValueExact();
    }
}
