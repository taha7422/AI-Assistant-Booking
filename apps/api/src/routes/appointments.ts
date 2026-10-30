import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { HttpError } from '../middleware/errors.js';
import { cancelBooking, createBooking, getAppointments, getAvailability, getServices } from '../services/booking.js';

const router = Router();
const bodySchema = z.object({ serviceId: z.string().uuid(), startsAt: z.string().datetime({ offset: true }) }).strict();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
function authScope(req: Request) {
  if (!req.userId || !req.businessId) throw new HttpError(401, 'Authentication required.', 'AUTH_REQUIRED');
  return { userId: req.userId, businessId: req.businessId };
}

router.get('/services', async (req, res) => {
  const { businessId } = authScope(req);
  res.json({ data: await getServices(businessId) });
});
router.get('/availability', async (req, res) => {
  const { businessId } = authScope(req);
  const date = dateSchema.parse(req.query.date);
  const serviceId = z.string().uuid().parse(req.query.serviceId);
  res.json({ data: await getAvailability(businessId, serviceId, date) });
});
router.post('/', async (req, res) => {
  const { userId, businessId } = authScope(req);
  const input = bodySchema.parse(req.body);
  res.status(201).json({ data: await createBooking(businessId, userId, input.serviceId, input.startsAt, 'form') });
});
router.get('/', async (req, res) => {
  const { userId, businessId } = authScope(req);
  res.json({ data: await getAppointments(businessId, userId) });
});
async function cancel(req: Request, res: Response) {
  const { userId, businessId } = authScope(req);
  const id = z.string().uuid().parse(req.params.id);
  res.json({ data: await cancelBooking(businessId, userId, id) });
}
router.patch('/:id/cancel', cancel);
router.delete('/:id', cancel);
export default router;
