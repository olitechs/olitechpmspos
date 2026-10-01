import { z } from 'zod';

const dateRange = (schema) => schema.refine(
  (data) => data.arrival < data.departure,
  { message: 'Departure must be after arrival.', path: ['departure'] }
);

export const reservationFormSchema = dateRange(
  z.object({
    guest: z.string().trim().min(2, 'Guest name is required.').max(120),
    phone: z.string().trim().min(7, 'Enter a valid phone number.').max(30),
    roomId: z.string().min(1, 'Select a room.'),
    arrival: z.string().min(1, 'Arrival date is required.'),
    departure: z.string().min(1, 'Departure date is required.'),
    partySize: z.coerce.number().int().min(1, 'At least one guest is required.').max(50),
    rate: z.coerce.number().finite().min(0, 'Rate cannot be negative.').max(100000000),
    channel: z.string().min(1),
    mealPlan: z.string().min(1),
  })
);

export const walkInCheckInSchema = z.object({
    name: z.string().trim().min(2, 'Guest name is required.').max(120),
    phone: z.string().trim().min(7, 'Enter a valid phone number.').max(30),
    checkIn: z.string().min(1, 'Check-in date is required.'),
    checkOut: z.string().min(1, 'Check-out date is required.'),
    partySize: z.coerce.number().int().min(1, 'At least one guest is required.').max(50),
    rate: z.coerce.number().finite().min(0, 'Rate cannot be negative.').max(100000000),
  }).refine((data) => data.checkIn < data.checkOut, {
    message: 'Check-out must be after check-in.', path: ['checkOut']
  });

export const propertyPatchSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  business_name: z.string().trim().max(160).optional(),
  city: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().optional().or(z.literal('')),
  website: z.string().trim().url().optional().or(z.literal('')),
});
