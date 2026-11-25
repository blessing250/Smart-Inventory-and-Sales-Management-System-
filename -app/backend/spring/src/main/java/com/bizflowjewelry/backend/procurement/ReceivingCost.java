package com.bizflowjewelry.backend.procurement;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.List;

final class ReceivingCost {
    private ReceivingCost() {}

    static long share(long amount, long numerator, long denominator) {
        var divisor = BigInteger.valueOf(denominator);
        return BigInteger.valueOf(amount).multiply(BigInteger.valueOf(numerator))
                .add(divisor.divide(BigInteger.TWO)).divide(divisor).longValueExact();
    }

    static long convert(long quantity, long unitMinor, String currency, long rate) {
        return share(Math.multiplyExact(quantity, unitMinor), rate, currency.equals("RWF") ? 1_000_000 : 100_000_000);
    }

    static long portion(long total, long prior, long quantity, long ordered) {
        return share(total, prior + quantity, ordered) - share(total, prior, ordered);
    }

    static List<Long> allocate(long amount, List<Long> weights) {
        long denominator = weights.stream().mapToLong(Long::longValue).sum();
        var budgets = new ArrayList<Long>(weights.size());
        long prior = 0;
        for (long weight : weights) {
            budgets.add(portion(amount, prior, weight, denominator));
            prior += weight;
        }
        return budgets;
    }
}
