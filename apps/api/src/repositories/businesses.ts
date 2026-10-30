import { query } from '../db.js';

export type Business = { id: string; name: string; slug: string; timezone: string };

export async function getDefaultBusiness(): Promise<Business | null> {
  return (await query<Business>('SELECT id,name,slug,timezone FROM businesses WHERE slug=$1', ['default'])).rows[0] ?? null;
}

export async function getBusiness(id: string): Promise<Business | null> {
  return (await query<Business>('SELECT id,name,slug,timezone FROM businesses WHERE id=$1', [id])).rows[0] ?? null;
}
