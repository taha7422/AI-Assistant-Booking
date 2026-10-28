import { Mistral } from '@mistralai/mistralai';
import { z } from 'zod';
import { env } from '../config.js';
import { query } from '../db.js';
const intentSchema=z.object({serviceName:z.string().max(100).nullable(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable()}).strict();
const answerSchema=z.object({reply:z.string().min(1).max(1600),intent:intentSchema}).strict();
const messageSchema=z.array(z.object({role:z.enum(['user','assistant']),content:z.string().min(1).max(2000)})).min(1).max(12);
const client=env.MISTRAL_API_KEY?new Mistral({apiKey:env.MISTRAL_API_KEY}):null;
export async function answer(messages:unknown){const history=messageSchema.parse(messages);if(history.at(-1)?.role!=='user')throw new Error('A user message must be last.');const services=await query<{name:string}>('SELECT name FROM services WHERE active=true ORDER BY name');let raw:unknown;
  if(!client){const user=history.at(-1)!.content;const service=services.rows.find(s=>user.toLowerCase().includes(s.name.toLowerCase()));const date=user.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]??null;const time=user.match(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/)?.[0]??null;raw={reply:service&&date&&time?`I understood ${service.name} on ${date} at ${time}. Please review the booking form to confirm; I cannot book directly from chat.`:'I can help you choose a service and time. Tell me a service, weekday date (YYYY-MM-DD), and time (HH:MM). You can always use the manual booking form below.',intent:{serviceName:service?.name??null,date,time}};
  }else{const completion=await client.chat.complete({model:env.MISTRAL_MODEL,temperature:0.1,maxTokens:350,responseFormat:{type:'json_object'},messages:[{role:'system',content:`You are the AI Assistant Booking intake helper. Available services: ${services.rows.map(s=>s.name).join(', ')||'none'}. Extract only serviceName, ISO calendar date (YYYY-MM-DD), and 24-hour time (HH:MM) if explicitly present in conversation. Never claim an appointment was booked or available. Ask for missing details. Return ONLY JSON: {"reply":"short helpful response","intent":{"serviceName":string|null,"date":string|null,"time":string|null}}.`},...history]});raw=completion.choices?.[0]?.message?.content;}
  let parsed:unknown=raw;if(typeof raw==='string')parsed=JSON.parse(raw);return answerSchema.parse(parsed);
}
