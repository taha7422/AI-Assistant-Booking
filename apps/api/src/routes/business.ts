import { Router } from 'express';
import { HttpError } from '../middleware/errors.js';
import { getBusiness } from '../repositories/businesses.js';

const router = Router();
router.get('/', async (req, res) => {
  if (!req.businessId) throw new HttpError(401, 'Authentication required.', 'AUTH_REQUIRED');
  const business = await getBusiness(req.businessId);
  if (!business) throw new HttpError(404, 'Business not found.', 'BUSINESS_NOT_FOUND');
  res.json({ data: {
    id: business.id,
    name: business.name,
    timeZone: business.timezone,
    operatingHours: { weekdays: [1, 2, 3, 4, 5], opensAt: '09:00', closesAt: '17:00', slotMinutes: 30 },
    bookingWindowDays: 30,
    minimumLeadMinutes: 60,
  } });
});
export default router;
