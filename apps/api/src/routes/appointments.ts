import {Router} from 'express';import {z} from 'zod';import {HttpError} from '../middleware/errors.js';import {getServices,getAvailability,createBooking,getAppointments,cancelBooking} from '../services/booking.js';
const router=Router();const bodySchema=z.object({serviceId:z.string().uuid(),startsAt:z.string().datetime({offset:true})});
router.get('/services',async(_req,res)=>res.json({data:await getServices()}));
router.get('/availability',async(req,res)=>{const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.query.date);const serviceId=z.string().uuid().parse(req.query.serviceId);res.json({data:await getAvailability(serviceId,date)});});
router.post('/',async(req,res)=>{if(!req.userId)throw new HttpError(401,'Authentication required.');const input=bodySchema.parse(req.body);res.status(201).json({data:await createBooking(req.userId,input.serviceId,input.startsAt)});});
router.get('/',async(req,res)=>{if(!req.userId)throw new HttpError(401,'Authentication required.');res.json({data:await getAppointments(req.userId)});});
router.delete('/:id',async(req,res)=>{if(!req.userId)throw new HttpError(401,'Authentication required.');const id=z.string().uuid().parse(req.params.id);res.json({data:await cancelBooking(req.userId,id)});});
export default router;
