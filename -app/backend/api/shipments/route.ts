import { ownerRoute, parse } from '@/backend/auth/auth-utils';
import { dataStore } from '@/backend/database/data-store';
import { shipmentAction } from '@/shared/validation/shipment-input';

export const GET = ownerRoute(() => dataStore.getShipments());
export const POST = ownerRoute(async (request, actor) => {
  const input = await parse(request, shipmentAction);
  switch (input.action) {
    case 'create': return dataStore.createShipment(input.reference, input.agent, actor, input.manifest);
    case 'dispatch': return dataStore.dispatchShipment(input.id, actor);
    case 'record': return dataStore.recordShipmentEvent(input, actor);
    case 'receive': return dataStore.receiveShipment(input.id, input.lines, input.expenses, input.allocation, actor);
  }
});
