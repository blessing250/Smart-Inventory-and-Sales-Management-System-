import { z } from 'zod';
import { money, nonnegativeQuantity, quantity } from './business-input';

const text = z.string().trim();
const item_id = text.min(1);
const allocation = z.enum(['quantity', 'value']);
const expenses = z.object({ shipping: money, customs: money, clearing: money, other: money });
const manifest = z.object({
  origin: text.max(150), destination: text.max(150), expected_date: z.union([z.literal(''), z.iso.date()]),
  notes: text.max(1000), expected_expenses: money,
  lines: z.array(z.object({ item_id, quantity })).min(1).max(100),
});
const event = z.object({
  action: z.literal('record'), id: item_id, reference: text.min(1).max(100),
  charges: z.object({ allocation, expenses }).optional(),
  lines: z.array(z.object({
    item_id, usable: nonnegativeQuantity, damaged: nonnegativeQuantity, missing: nonnegativeQuantity,
    explanation: text.max(500),
  }).refine(line => line.usable + line.damaged + line.missing > 0, 'Enter a quantity to reconcile.')
    .refine(line => !line.damaged && !line.missing || !!line.explanation, 'Explain any damaged or missing units.')).min(1).max(100),
});

export type ShipmentManifest = z.infer<typeof manifest>;
export type ShipmentEvent = z.infer<typeof event>;
export const shipmentAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), reference: text.min(1).max(100), agent: text.min(1).max(200), manifest: manifest.optional() }),
  z.object({ action: z.literal('dispatch'), id: item_id }),
  event,
  z.object({ action: z.literal('receive'), id: item_id,
    lines: z.array(z.object({ item_id, quantity })).min(1).max(100), expenses, allocation }),
]);
